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
                 plan_lines: int = 0):
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
        if worlds > 0:
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
                                     plan_lines=plan_lines)

    def name(self) -> str:
        base = self.spec.split("/")[-1]
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
                   win_score: int = 500, lose_score: int = -250):
    """side0 is team A unless flip. Returns (winning_side_idx, diff_for_side0,
    per-side auction stats)."""
    sides = [side1, side0] if flip else [side0, side1]  # index by team
    env = SelfPlayGame(seed=pair_seed, deck_fn=deck_stream(pair_seed),
                       dealer=pair_seed % 4,
                       win_score=win_score, lose_score=lose_score)
    rng = random.Random(pair_seed ^ 0xD0E1)
    pending: dict[int, list[int]] = {0: [], 1: []}
    heur_styles = ["basic"] * 4

    while not env.done:
        seat, dtype, cands = env.decision()
        team = team_of(seat)
        side = sides[team]
        scripted = dtype in side.script or side.style is not None
        if not scripted:
            if side.agent is not None:
                action = side.agent.choose(env, seat, dtype, cands)
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
    return winner_side, diff0, stats


def _play_pair(side_a: Side, side_b: Side, pair_seed: int,
               win_score: int, lose_score: int):
    return [play_duel_game(side_a, side_b, pair_seed, flip,
                           win_score, lose_score) for flip in (False, True)]


# --- multiprocess plumbing: each worker builds its own Sides once ----------

_W: dict = {}


def _worker_init(a_args: tuple, b_args: tuple, win: int, lose: int):
    torch.set_num_threads(1)  # one pair per process; don't thrash cores
    _W["a"] = Side(*a_args)
    _W["b"] = Side(*b_args)
    _W["win"], _W["lose"] = win, lose


def _worker_pair(pair_seed: int):
    return pair_seed, _play_pair(_W["a"], _W["b"], pair_seed,
                                 _W["win"], _W["lose"])


def duel(side_a: Side, side_b: Side, n_pairs: int, seed: int = 0,
         verbose: bool = True, win_score: int = 500, lose_score: int = -250,
         workers: int = 1, side_args: tuple | None = None):
    """side_args = (a_ctor_args, b_ctor_args) enables workers > 1: live-net
    Sides can't cross process boundaries, so workers rebuild them from specs."""
    a_wins = b_wins = sweeps_a = sweeps_b = 0
    diffs = []
    auct = {0: dict(contracts=0, made=0, bid_sum=0),
            1: dict(contracts=0, made=0, bid_sum=0)}
    t0 = time.time()

    def pair_stream():
        pair_seeds = [seed + p * 104729 + 1 for p in range(n_pairs)]
        if workers > 1:
            assert side_args is not None, "workers need side ctor args"
            import multiprocessing as mp
            ctx = mp.get_context("spawn")
            with ctx.Pool(workers, initializer=_worker_init,
                          initargs=(*side_args, win_score, lose_score)) as pool:
                for _, res in pool.imap_unordered(_worker_pair, pair_seeds):
                    yield res
        else:
            for ps in pair_seeds:
                yield _play_pair(side_a, side_b, ps, win_score, lose_score)

    for p, pair in enumerate(pair_stream()):
        results = []
        for w, d, st in pair:
            results.append(w)
            diffs.append(d)
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
    ap.add_argument("--workers", type=int, default=1,
                    help="parallel pair-playing processes (search is slow)")
    args = ap.parse_args()
    lose = args.lose_score if args.lose_score is not None else -args.win_score // 2
    a_args = (args.a, args.script_a, None, args.worlds_a, args.search_a,
              args.prior_a, args.min_trick_a, args.infer_a, args.bid_infer_a,
              args.belief_a, args.belief_temp_a, args.fork_depth_a,
              args.fork_width_a, args.plan_lines_a)
    b_args = (args.b, args.script_b, None, args.worlds_b, args.search_b,
              args.prior_b, args.min_trick_b, args.infer_b, args.bid_infer_b,
              args.belief_b, args.belief_temp_b, args.fork_depth_b,
              args.fork_width_b, args.plan_lines_b)
    duel(Side(*a_args), Side(*b_args),
         args.pairs, args.seed, win_score=args.win_score, lose_score=lose,
         workers=args.workers, side_args=(a_args, b_args))


if __name__ == "__main__":
    main()
