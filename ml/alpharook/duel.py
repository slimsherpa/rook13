"""The champion's ladder: two agents, identical deals, swapped seats.

Riley's benchmark design: every pair of games uses the SAME pre-generated
deck sequence and the same first dealer — only the teams swap chairs. Deal
luck cancels out, so a pair won 2-0 is real signal ("swept"), 1-1 is a
wash. Agents are feedforward and stateless across games, so a repeated
deal cannot be "remembered" — only played better.

Each side is a checkpoint (or a heuristic style like `basic`) plus a script
mode saying which decisions the family heuristic still makes for it. That
lets bidding STYLES fight directly: e.g. gen7's learned bidding (--script-a
godown) vs gen6 with the family's scripted bidding (--script-b openings),
both using their learned card play.

    python -m alpharook.duel --a models/gen7.pt --script-a godown \
        --b runs/gen6/latest.pt --script-b openings --pairs 100

gen11 is a side with `--worlds-a K`: the same checkpoint, but every bid,
trump call and card play runs K-world PIMC search with the net as the
rollout policy (see search.py). Search is ~two orders slower than a bare
forward pass, so `--workers N` fans pairs out across processes:

    python -m alpharook.duel --a models/gen10.pt --worlds-a 12 \
        --b models/gen10.pt --script-a none --script-b none \
        --pairs 150 --workers 7
"""

from __future__ import annotations

import argparse
import json
import random
import time

import torch

from rook.cards import team_of, create_deck
from rook.bots import next_bot_action, best_trump_suit
from rook.engine import WIDOW as PHASE_WIDOW
from .encoder import D_DISCARD, D_TRUMP
from .env import SelfPlayGame
from .model import QNet
from .selfplay import SCRIPT_MODES
from .arena import model_choose


class Side:
    """One competitor: a QNet checkpoint, a live net, or a heuristic style.
    `worlds > 0` wraps the net in PIMC search (gen11): same brain, but every
    unscripted decision gets K-world look-ahead instead of one reflex pass."""

    def __init__(self, spec: str, script: str, net: QNet | None = None,
                 worlds: int = 0, search: str = "bid,trump,play",
                 prior: float = 4.0, min_trick: int = 0,
                 infer_temp: float = 0.0, bid_infer: float = 0.0,
                 belief_ckpt: str | None = None, belief_temp: float = 1.0,
                 fork_depth: int = 0, fork_width: int = 3,
                 plan_lines: int = 0, god: bool = False,
                 solve_tail: int = 0, mortal: int = 0, mrook: int = 0,
                 anytime: float = 0.0, mwidow: float = 0.0,
                 proposer: str | None = None):
        self.spec = spec
        self.script = SCRIPT_MODES[script]
        self.net = net
        self.style = None
        self.worlds = worlds
        self.search = search
        self.prior = prior
        self.min_trick = min_trick
        self.infer_temp = infer_temp
        self.bid_infer = bid_infer
        self.belief_ckpt = belief_ckpt
        self.belief_temp = belief_temp
        self.fork_depth = fork_depth
        self.fork_width = fork_width
        self.plan_lines = plan_lines
        if net is not None:
            pass  # live net passed in (e.g. the training learner)
        elif spec in ("random", "basic", "aggressive", "cautious"):
            self.style = spec
        else:
            from .model import load_qnet
            self.net = load_qnet(spec)
        self.agent = None
        self.god = god
        self.mortal = mortal
        self.mrook = mrook
        self.anytime = anytime
        self.mwidow = mwidow
        if anytime:
            assert self.net is not None and belief_ckpt
            assert worlds == 0 and not god and not mortal and not mrook
            from .beliefs import BeliefOracle
            from .anytime import AnytimeRookAgent
            belief = BeliefOracle(belief_ckpt, temp=belief_temp)
            self.agent = AnytimeRookAgent(self.net, belief,
                                          budget_scale=anytime)
            if mwidow:
                # THE ASSEMBLED CANDIDATE (P3): anytime card core +
                # MortalWidow burial (proposer-shortlisted when given)
                from .mortalwidow import MortalWidowAgent
                prop = None
                if proposer:
                    import torch as _torch
                    from .widowprop import WidowProp
                    ck = _torch.load(proposer, weights_only=False)
                    prop = WidowProp(ck["d_state"])
                    prop.load_state_dict(ck["state_dict"])
                    prop.eval()
                self.agent = MortalWidowAgent(
                    self.net, belief, play_agent=self.agent,
                    budget_s=mwidow, k_min=16, proposer=prop)
        elif mrook:
            assert self.net is not None and belief_ckpt
            assert worlds == 0 and not god and not mortal
            from .beliefs import BeliefOracle
            from .mortalgod import MortalRookAgent
            self.agent = MortalRookAgent(
                self.net, BeliefOracle(belief_ckpt, temp=belief_temp),
                worlds=mrook)
        elif mortal:
            assert self.net is not None, "mortal god bids with a net"
            assert worlds == 0 and not god, "mortal replaces search/god"
            assert belief_ckpt, "mortal god imagines through a belief net"
            from .beliefs import BeliefOracle
            from .mortalgod import MortalGodAgent
            self.agent = MortalGodAgent(
                self.net, BeliefOracle(belief_ckpt, temp=belief_temp),
                worlds=mortal)
        elif god:
            assert self.net is not None, "god mode bids with a net"
            assert worlds == 0, "god does not imagine; god knows"
            from .god import GodAgent
            self.agent = GodAgent(self.net)
        elif worlds > 0:
            assert self.net is not None, "search needs a net"
            from .search import SearchAgent
            from .encoder import D_BID, D_DISCARD, D_TRUMP, D_PLAY
            names = {"bid": D_BID, "discard": D_DISCARD, "trump": D_TRUMP,
                     "play": D_PLAY}
            dtypes = frozenset(names[t] for t in search.split(","))
            belief = None
            if belief_ckpt:
                from .beliefs import BeliefOracle
                belief = BeliefOracle(belief_ckpt, temp=belief_temp)
            self.agent = SearchAgent(self.net, worlds=worlds,
                                     search_dtypes=dtypes, prior_weight=prior,
                                     min_trick=min_trick,
                                     infer_temp=infer_temp,
                                     bid_infer=bid_infer, belief=belief,
                                     fork_depth=fork_depth,
                                     fork_width=fork_width,
                                     plan_lines=plan_lines,
                                     solve_tail=solve_tail)

    def name(self) -> str:
        base = self.spec.split("/")[-1]
        if self.anytime and self.mwidow:
            return (f"{base}+ASSEMBLED(any x{self.anytime:g}, "
                    f"widow {self.mwidow:g}s, "
                    f"B:{self.belief_ckpt.split('/')[-1]}@{self.belief_temp:g})")
        if self.anytime:
            return (f"{base}+ANYTIME(x{self.anytime:g},"
                    f"B:{self.belief_ckpt.split('/')[-1]}@{self.belief_temp:g})")
        if self.mrook:
            return f"{base}+MORTALROOK(K{self.mrook},confirm24,tau2)"
        if self.mortal:
            return (f"{base}+MORTALGOD(K{self.mortal},"
                    f"B:{self.belief_ckpt.split('/')[-1]}@{self.belief_temp:g})")
        if self.god:
            return f"{base}+GOD(omniscient play)"
        if not self.worlds:
            return base
        bel = (f",B:{self.belief_ckpt.split('/')[-1]}@{self.belief_temp:g}"
               if self.belief_ckpt else "")
        fork = (f",f{self.fork_depth}x{self.fork_width}"
                if self.fork_depth else "")
        plan = f",p{self.plan_lines}" if self.plan_lines else ""
        return (f"{base}+search{self.worlds}({self.search},w{self.prior:g}"
                f",t{self.min_trick},i{self.infer_temp:g},b{self.bid_infer:g}"
                f"{bel}{fork}{plan})")


def deck_stream(pair_seed: int):
    def deck_fn(i: int) -> list[int]:
        deck = create_deck()
        random.Random(pair_seed * 1_000_003 + i * 7919).shuffle(deck)
        return deck
    return deck_fn


@torch.no_grad()
def play_duel_game(side0: Side, side1: Side, pair_seed: int, flip: bool,
                   win_score: int = 500, lose_score: int = -250,
                   record: bool = False):
    """side0 is team A unless flip. Returns (winning_side_idx, diff_for_side0,
    per-side auction stats).

    `record` also captures the full action sequence in mimic format, so a
    measurement run doubles as teacher corpus. Every decision from BOTH
    sides is kept — that is what makes the game replayable — each tagged
    with which side made it, plus the reflex choice and a searched flag for
    side 0, which is where the needles are.
    """
    sides = [side1, side0] if flip else [side0, side1]  # index by team
    env = SelfPlayGame(seed=pair_seed, deck_fn=deck_stream(pair_seed),
                       dealer=pair_seed % 4,
                       win_score=win_score, lose_score=lose_score)
    rng = random.Random(pair_seed ^ 0xD0E1)
    pending: dict[int, list[int]] = {0: [], 1: []}
    heur_styles = ["basic"] * 4
    decs: list = []
    side0_team = 1 if flip else 0

    while not env.done:
        seat, dtype, cands = env.decision()
        team = team_of(seat)
        side = sides[team]
        scripted = dtype in side.script or side.style is not None
        reflex = -1
        searched = 0
        if not scripted:
            if side.agent is not None:
                action = side.agent.choose(env, seat, dtype, cands)
                if record and team == side0_team and len(cands) > 1 \
                        and side.agent.last_search is not None:
                    # the needle test: what would the bare reflex have done?
                    reflex = int(model_choose(side.net, "cpu", env, seat,
                                              dtype, cands))
                    searched = 1
            else:
                action = model_choose(side.net, "cpu", env, seat, dtype, cands)
        elif dtype == D_TRUMP and env.trump_intent is None and env.g.phase == PHASE_WIDOW:
            action = best_trump_suit(env.g.hands[seat])
        elif dtype == D_DISCARD:
            if not pending[team]:
                styles = [side.style or "basic"] * 4
                _, _, cards = next_bot_action(env.g, styles, rng)
                pending[team] = list(cards)
            action = pending[team].pop(0)
        else:
            styles = [side.style or "basic"] * 4
            _, _, action = next_bot_action(env.g, styles, rng)
        if record:
            decs.append([seat, dtype, int(action), reflex, searched,
                         1 if team == side0_team else 0])
        env.apply(action)

    s = env.g.scores
    team_of_side0 = 1 if flip else 0
    diff0 = s[team_of_side0] - s[1 - team_of_side0]
    winner_side = 0 if env.g.winner == team_of_side0 else 1

    stats = {0: dict(contracts=0, made=0, bid_sum=0),
             1: dict(contracts=0, made=0, bid_sum=0)}
    for h in env.g.hand_history:
        side_idx = 0 if team_of(h[1]) == team_of_side0 else 1
        stats[side_idx]["contracts"] += 1
        stats[side_idx]["made"] += 0 if h[6] else 1
        stats[side_idx]["bid_sum"] += h[2]
    game = dict(a=int(s[team_of_side0]), b=int(s[1 - team_of_side0]),
                hands=len(env.g.hand_history),
                # per-hand: [bidder_side (0=A), bid, made, score diff for A].
                # Hand k in both games of a pair = the SAME deal (redeals
                # consume deck indices identically), so pairing consecutive
                # dump lines aligns hands card-for-card.
                hh=[[0 if team_of(h[1]) == team_of_side0 else 1, h[2],
                     0 if h[6] else 1,
                     int(h[4] - h[5]) if team_of_side0 == 0
                     else int(h[5] - h[4])]
                    for h in env.g.hand_history])
    if record:
        game["seed"] = pair_seed
        game["flip"] = int(flip)
        game["win"] = win_score
        game["lose"] = lose_score
        game["d"] = decs
        game["n_srch"] = sum(x[4] for x in decs)
        game["n_ovr"] = sum(1 for x in decs if x[4] and x[3] != x[2])
    return winner_side, diff0, stats, game


def completed_pairs(dump_actions_path: str) -> set:
    """Pair seeds with BOTH mirror games already banked in the corpus file.
    Streams get killed (OOM, reboots, keeper restarts) and relaunched with
    the same seed base; without this, every relaunch replays the whole seed
    space at full search cost. Half-written pairs rerun whole — the miller
    dedups on (seed, flip)."""
    import os
    done: dict = {}
    if not os.path.exists(dump_actions_path):
        return set()
    with open(dump_actions_path) as f:
        for line in f:
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue        # torn tail line from a killed writer
            done.setdefault(r["seed"], set()).add(r["flip"])
    return {s for s, fl in done.items() if fl == {0, 1}}


def replay_duel_game(rec: dict, win_score: int = 2000,
                     lose_score: int = -1000) -> None:
    """Deterministically replay a recorded duel game and assert it lands on
    the same final scores. Cheap (no search) and it is what makes these
    records trustworthy as training data — same guarantee gen_mimic gives."""
    seed = rec["seed"]
    env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed),
                       dealer=seed % 4, win_score=win_score,
                       lose_score=lose_score)
    for seat, dtype, action, _r, _s, _side in rec["d"]:
        s2, d2, cands = env.decision()
        assert s2 == seat and d2 == dtype and action in cands, \
            f"replay divergence at seat {seat} dtype {dtype}"
        env.apply(action)
    t0 = 1 if rec["flip"] else 0
    assert env.done and int(env.g.scores[t0]) == rec["a"], "replay mismatch"


def _play_pair(side_a: Side, side_b: Side, pair_seed: int,
               win_score: int, lose_score: int, record: bool = False):
    return [play_duel_game(side_a, side_b, pair_seed, flip,
                           win_score, lose_score, record)
            for flip in (False, True)]


# --- multiprocess plumbing: each worker builds its own Sides once ----------

_W: dict = {}


def _worker_init(a_args: tuple, b_args: tuple, win: int, lose: int,
                 record: bool = False):
    torch.set_num_threads(1)  # one pair per process; don't thrash cores
    _W["a"] = Side(*a_args)
    _W["b"] = Side(*b_args)
    _W["win"], _W["lose"] = win, lose
    _W["record"] = record


def _worker_pair(pair_seed: int):
    return pair_seed, _play_pair(_W["a"], _W["b"], pair_seed,
                                 _W["win"], _W["lose"], _W.get("record"))


def duel(side_a: Side, side_b: Side, n_pairs: int, seed: int = 0,
         verbose: bool = True, win_score: int = 500, lose_score: int = -250,
         workers: int = 1, side_args: tuple | None = None,
         dump_path: str | None = None,
         dump_actions_path: str | None = None):
    """side_args = (a_ctor_args, b_ctor_args) enables workers > 1: live-net
    Sides can't cross process boundaries, so workers rebuild them from specs."""
    a_wins = b_wins = sweeps_a = sweeps_b = 0
    diffs = []
    auct = {0: dict(contracts=0, made=0, bid_sum=0),
            1: dict(contracts=0, made=0, bid_sum=0)}
    t0 = time.time()

    def pair_stream():
        pair_seeds = [seed + p * 104729 + 1 for p in range(n_pairs)]
        if dump_actions_path:
            done = completed_pairs(dump_actions_path)
            if done:
                pair_seeds = [s for s in pair_seeds if s not in done]
                print(f"  resume: {len(done)} pairs already banked, "
                      f"{len(pair_seeds)} to play", flush=True)
        if workers > 1:
            assert side_args is not None, "workers need side ctor args"
            import multiprocessing as mp
            ctx = mp.get_context("spawn")
            with ctx.Pool(workers, initializer=_worker_init,
                          initargs=(*side_args, win_score, lose_score,
                                    bool(dump_actions_path))) as pool:
                for _, res in pool.imap_unordered(_worker_pair, pair_seeds):
                    yield res
        else:
            for ps in pair_seeds:
                yield _play_pair(side_a, side_b, ps, win_score, lose_score,
                                 bool(dump_actions_path))

    dump_f = open(dump_path, "a") if dump_path else None
    act_f = open(dump_actions_path, "a") if dump_actions_path else None
    for p, pair in enumerate(pair_stream()):
        results = []
        for w, d, st, gm in pair:
            results.append(w)
            diffs.append(d)
            import json as _json
            if act_f is not None and "d" in gm:
                # verify before trusting: a corpus row that cannot be
                # replayed is worse than no corpus row at all
                try:
                    replay_duel_game(gm, win_score, lose_score)
                    act_f.write(_json.dumps(
                        {k: gm[k] for k in
                         ("seed", "flip", "win", "lose",
                          "d", "n_srch", "n_ovr", "hands")})
                        + "\n")
                    act_f.flush()
                except AssertionError:
                    pass
            gm = {k: v for k, v in gm.items() if k != "d"}
            if dump_f is not None:
                rec = dict(gm, w=int(w),
                           a_contracts=st[0]["contracts"],
                           a_made=st[0]["made"], a_bids=st[0]["bid_sum"],
                           b_contracts=st[1]["contracts"],
                           b_made=st[1]["made"], b_bids=st[1]["bid_sum"])
                dump_f.write(_json.dumps(rec) + "\n")
                dump_f.flush()
            for i in (0, 1):
                for k in auct[i]:
                    auct[i][k] += st[i][k]
            if w == 0:
                a_wins += 1
            else:
                b_wins += 1
        if results == [0, 0]:
            sweeps_a += 1
        elif results == [1, 1]:
            sweeps_b += 1
        if verbose and (p + 1) % 5 == 0:
            done = 2 * (p + 1)
            print(f"  [{p + 1}/{n_pairs} pairs] A {a_wins}-{b_wins} "
                  f"({a_wins / done:.1%}), sweeps {sweeps_a}-{sweeps_b}, "
                  f"{(time.time() - t0) / done:.1f}s/game", flush=True)

    games = 2 * n_pairs
    if not verbose:
        return a_wins / games
    print(f"{side_a.name()} vs {side_b.name()} — {n_pairs} deal-pairs "
          f"({games} games, duplicate decks, seats swapped):")
    print(f"  {side_a.name()}: {a_wins / games:.1%} wins "
          f"(avg diff {sum(diffs) / games:+.1f})")
    print(f"  pairs swept: {side_a.name()} {sweeps_a}, {side_b.name()} "
          f"{sweeps_b}, split {n_pairs - sweeps_a - sweeps_b}")
    for i, side in ((0, side_a), (1, side_b)):
        c = max(1, auct[i]["contracts"])
        print(f"  {side.name()} auctions: won {auct[i]['contracts']} contracts, "
              f"made {auct[i]['made'] / c:.0%} at avg bid "
              f"{auct[i]['bid_sum'] / c:.1f}")
    return a_wins / games


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", required=True, help="checkpoint path or bot style")
    ap.add_argument("--b", required=True)
    ap.add_argument("--script-a", default="godown",
                    choices=list(SCRIPT_MODES))
    ap.add_argument("--script-b", default="godown",
                    choices=list(SCRIPT_MODES))
    ap.add_argument("--pairs", type=int, default=100)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--win-score", type=int, default=500,
                    help="marathon evals (e.g. 2000) pack more hands per "
                         "game — less card luck, sharper skill signal")
    ap.add_argument("--lose-score", type=int, default=None)
    ap.add_argument("--worlds-a", type=int, default=0,
                    help="wrap side A in K-world PIMC search (gen11)")
    ap.add_argument("--worlds-b", type=int, default=0)
    ap.add_argument("--search-a", default="bid,trump,play",
                    help="comma list of searched decisions (bid,discard,trump,play)")
    ap.add_argument("--search-b", default="bid,trump,play")
    ap.add_argument("--prior-a", type=float, default=4.0,
                    help="pseudo-rollout weight of the net's Q at the root")
    ap.add_argument("--prior-b", type=float, default=4.0)
    ap.add_argument("--min-trick-a", type=int, default=0,
                    help="only search plays from this trick on (endgame gate)")
    ap.add_argument("--min-trick-b", type=int, default=0)
    ap.add_argument("--infer-a", type=float, default=0.0,
                    help="world-inference softmax temperature (0 = uniform)")
    ap.add_argument("--infer-b", type=float, default=0.0)
    ap.add_argument("--bid-infer-a", type=float, default=0.0,
                    help="auction-aware world weighting sigma in bid points "
                         "(0 = off)")
    ap.add_argument("--bid-infer-b", type=float, default=0.0)
    ap.add_argument("--belief-a", default=None,
                    help="gen15+ checkpoint whose belief head samples side "
                         "A's imagined worlds (gen16 belief-guided search)")
    ap.add_argument("--belief-b", default=None)
    ap.add_argument("--belief-temp-a", type=float, default=1.0,
                    help="softmax temp over holder classes (>1 hedges "
                         "toward uniform)")
    ap.add_argument("--belief-temp-b", type=float, default=1.0)
    ap.add_argument("--fork-depth-a", type=int, default=0,
                    help="gen16 plan tree: branch my next N plays inside "
                         "each rollout (0 = single-line rollouts)")
    ap.add_argument("--fork-depth-b", type=int, default=0)
    ap.add_argument("--fork-width-a", type=int, default=3,
                    help="candidates tried per fork (top-N by Q)")
    ap.add_argument("--fork-width-b", type=int, default=3)
    ap.add_argument("--plan-lines-a", type=int, default=0,
                    help="gen16 world-consistent plans: score L root-chosen "
                         "next-play intentions per candidate, same line "
                         "across all worlds (fusion-free)")
    ap.add_argument("--plan-lines-b", type=int, default=0)
    ap.add_argument("--solve-tail-a", type=int, default=0,
                    help="T2: exact-solve rollout tails once <= N tricks "
                         "remain (0 = off; 4 = measured sweet spot)")
    ap.add_argument("--solve-tail-b", type=int, default=0)
    ap.add_argument("--mortal-a", type=int, default=0,
                    help="MORTALGOD card play: exact-solve every candidate "
                         "in K belief-sampled worlds, average in family "
                         "hand currency, argmax (needs --belief-a)")
    ap.add_argument("--mortal-b", type=int, default=0)
    ap.add_argument("--mrook-a", type=int, default=0,
                    help="MORTALROOK: disciplined mortal — reflex incumbent "
                         "+ split-sample-confirmed overrides (sel K, eval "
                         "24, tau 2). Needs --belief-a")
    ap.add_argument("--mrook-b", type=int, default=0)
    ap.add_argument("--anytime-a", type=float, default=0.0,
                    help="P1.1 ANYTIME searcher: budget_scale multiplying "
                         "the P0 think-time map (1.0 = the 8-12s charter "
                         "clock). Adaptive K: obvious-card stop + budget "
                         "stop + node-capped world solves. Needs --belief-a")
    ap.add_argument("--anytime-b", type=float, default=0.0)
    ap.add_argument("--mwidow-a", type=float, default=0.0,
                    help="P3 assembly: MortalWidow burial at this budget "
                         "(seconds) on top of --anytime-a (0 = off)")
    ap.add_argument("--mwidow-b", type=float, default=0.0)
    ap.add_argument("--proposer-a", default=None,
                    help="WidowProp ckpt for --mwidow-a's shortlist")
    ap.add_argument("--proposer-b", default=None)
    ap.add_argument("--god-a", action="store_true",
                    help="ALPHAGODROOK: side A plays cards with the exact "
                         "omniscient solver (bids stay with --a's net)")
    ap.add_argument("--god-b", action="store_true")
    ap.add_argument("--workers", type=int, default=1,
                    help="parallel pair-playing processes (search is slow)")
    ap.add_argument("--dump-actions", default=None,
                    help="JSONL path: the full ACTION SEQUENCE per game in "
                         "mimic format (seed + every decision, replay-"
                         "verified), so a measurement run doubles as "
                         "teacher corpus. Side A's searched decisions carry "
                         "the reflex choice, making the needles millable "
                         "later.")
    ap.add_argument("--dump", default=None,
                    help="JSONL path: one line per game (final scores, "
                         "hands, per-side contracts/made/bids) for "
                         "gauntlet-style stat tables")
    args = ap.parse_args()
    lose = args.lose_score if args.lose_score is not None else -args.win_score // 2
    a_args = (args.a, args.script_a, None, args.worlds_a, args.search_a,
              args.prior_a, args.min_trick_a, args.infer_a, args.bid_infer_a,
              args.belief_a, args.belief_temp_a, args.fork_depth_a,
              args.fork_width_a, args.plan_lines_a, args.god_a,
              args.solve_tail_a, args.mortal_a, args.mrook_a, args.anytime_a,
              args.mwidow_a, args.proposer_a)
    b_args = (args.b, args.script_b, None, args.worlds_b, args.search_b,
              args.prior_b, args.min_trick_b, args.infer_b, args.bid_infer_b,
              args.belief_b, args.belief_temp_b, args.fork_depth_b,
              args.fork_width_b, args.plan_lines_b, args.god_b,
              args.solve_tail_b, args.mortal_b, args.mrook_b, args.anytime_b,
              args.mwidow_b, args.proposer_b)
    duel(Side(*a_args), Side(*b_args),
         args.pairs, args.seed, win_score=args.win_score, lose_score=lose,
         workers=args.workers, side_args=(a_args, b_args),
         dump_path=args.dump, dump_actions_path=args.dump_actions)


if __name__ == "__main__":
    main()
