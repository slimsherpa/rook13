"""AlphaBid — the bid oracle: read your cards, read the bids, imagine the
table thousands of times, then wager in game-win currency.

For each candidate bid at a live auction decision:

  1. SAMPLE K worlds — assignments of the 31 unseen cards to the other
     three seats and the widow. In `listen` mode each world is importance-
     weighted by how well it EXPLAINS the bids already made ("she bid 105;
     deal her hands that would bid 105" — and "he passed; don't deal him a
     monster"). This is the Bayes step, and it is what makes every bid
     along the way informative, exactly the GIB/bridge-bot recipe.
  2. ROLL OUT the rest of the hand in each world with frozen gen23 reflex
     playing all four seats — the rest of the auction, the go-down, trump,
     every card. Bidding strength is measured FOR the player who will
     actually play the cards.
  3. SCORE each candidate by the win-probability model (winprob.py) at the
     resulting scores — not card points. At -160, going set for 100 is not
     -100 points, it is the game; at 460-460 a cheap 65 that holds is a
     championship. The -250/+500 geometry is priced exactly.
  4. Bid the argmax.

The oracle is a TEACHER: too slow for the app, built to be measured and
then distilled (the gen21 -> gen23 mimic recipe, pointed at the auction).

Gate run (law 2 — 100+ pairs before believing anything):

    ~/torch-env/bin/python -m alpharook.bidoracle --pairs 120 --worlds 12 \
        --workers 6 --dump runs/gen24/oracle_gate.jsonl
"""

from __future__ import annotations

import argparse
import json
import math
import random
import time

import torch

from rook.cards import (
    PASS, SEATS, SUITS, VALID_BIDS, create_deck, team_of,
)
from rook.engine import (
    Game, BIDDING, WIDOW, TRUMP, PLAYING, HAND_DONE, GAME_OVER, bid_lead,
)
from rook.bots import estimate_tricks
from .arena import model_choose
from .bidcal import BidEvidence
from .duel import deck_stream
from .encoder import D_BID, D_DISCARD, D_TRUMP, D_PLAY
from .env import SelfPlayGame
from .model import load_qnet
from .winprob import WinProb


class RolloutEnv:
    """SelfPlayGame's decision protocol over a fabricated mid-hand Game.
    No dealing ever happens: the rollout finishes the CURRENT hand and
    stops (hand_done / game_over both count as done)."""

    def __init__(self, g: Game):
        self.g = g
        self.picks: list[int] = []
        self.trump_intent: int | None = None

    @property
    def done(self) -> bool:
        return self.g.phase in (HAND_DONE, GAME_OVER)

    def decision(self):
        g = self.g
        seat = g.turn
        if g.phase == BIDDING:
            floor = g.min_next_bid()
            if floor is None:
                return seat, D_BID, [PASS]
            cands = [b for b in VALID_BIDS if b >= floor]
            if not g.must_bid():
                cands = [PASS] + cands
            return seat, D_BID, cands
        if g.phase == WIDOW:
            if self.trump_intent is None:
                return seat, D_TRUMP, list(SUITS)
            hand = g.hands[seat]
            return seat, D_DISCARD, [c for c in hand if c not in self.picks]
        if g.phase == TRUMP:
            return seat, D_TRUMP, list(SUITS)
        if g.phase == PLAYING:
            return seat, D_PLAY, g.legal_cards(seat)
        raise ValueError(f"no decision in phase {g.phase}")

    def apply(self, action) -> None:
        g = self.g
        if g.phase == BIDDING:
            g.bid(g.turn, action)
        elif g.phase == WIDOW:
            if self.trump_intent is None:
                self.trump_intent = action
                return
            self.picks.append(action)
            if len(self.picks) == 4:
                g.select_go_down(g.turn, self.picks)
                self.picks = []
        elif g.phase == TRUMP:
            g.select_trump(g.turn, action)
        elif g.phase == PLAYING:
            g.play_card(g.turn, action)
        if g.phase == TRUMP and self.trump_intent is not None:
            g.select_trump(g.turn, self.trump_intent)
            self.trump_intent = None


# ---------------------------------------------------------------------------
# World sampling — the listening step
# ---------------------------------------------------------------------------

# Bid evidence uses the EMPIRICAL gen23 dialect (bidcal.py): its 65-95
# bids are one nearly-mute crawl class; the information lives at 100+.
# A pass one-sidedly rules out strong hands.


def _seat_evidence(g: Game, me: int) -> list[tuple[int, int | None]]:
    """(seat, highest real bid or None-if-passed) for seats with any voice.
    Silent seats (yet to speak) contribute no evidence."""
    out = []
    for s in SEATS:
        if s == me or g.bids[s] is None:
            continue
        best = None
        for seat, b in g.bid_history:
            if seat == s and b != PASS:
                best = b if best is None else max(best, b)
        out.append((s, best))
    return out


def sample_worlds(g: Game, me: int, k: int, listen, rng: random.Random,
                  oversample: int = 4):
    """Returns k assignments {seat: hand, 'widow': cards} of the 31 unseen
    cards. listen is a BidEvidence model (or None for uniform sampling);
    with evidence, worlds are importance-resampled by auction consistency."""
    mine = set(g.hands[me])
    unseen = [c for c in create_deck() if c not in mine]
    others = [s for s in SEATS if s != me]
    evidence = _seat_evidence(g, me) if listen is not None else []
    m = k * oversample if evidence else k
    worlds, weights = [], []
    for _ in range(m):
        rng.shuffle(unseen)
        w = {others[0]: unseen[0:9], others[1]: unseen[9:18],
             others[2]: unseen[18:27], "widow": unseen[27:31]}
        lw = 0.0
        for s, bid in evidence:
            t = estimate_tricks(w[s])
            lw += (listen.bid_at_least(t, bid) if bid is not None
                   else listen.passed_out(t))
        worlds.append({s: list(cards) for s, cards in w.items()})
        weights.append(lw)
    if len(worlds) == k:
        return worlds
    mx = max(weights)
    probs = [math.exp(x - mx) for x in weights]
    tot = sum(probs)
    probs = [p / tot for p in probs]
    picked = rng.choices(range(len(worlds)), weights=probs, k=k)
    return [worlds[i] for i in picked]


# ---------------------------------------------------------------------------
# The oracle
# ---------------------------------------------------------------------------


class OracleBidder:
    """Duck-typed like a bid policy: .bid(g, seat, cands) -> action.
    Reads ONLY the seat's own hand + public auction/score state."""

    def __init__(self, net, wp: WinProb, worlds: int = 16,
                 listen: bool = True, max_raises: int = 2,
                 margin: float = 0.02, widen: float = 1.5,
                 oversample: int = 4):
        # margin: a raise must beat PASS by this much win-probability to be
        # chosen. EV differences at K worlds carry ~1/sqrt(K) noise, and the
        # option menu is mostly raises — without a fold-unless-clearly-+EV
        # discipline the auction becomes a noise ratchet (gen11's
        # winner's-curse-on-searched-bids, rediscovered empirically here).
        self.net = net
        self.wp = wp
        self.worlds = worlds
        self.listen = BidEvidence(widen=widen) if listen else None
        self.max_raises = max_raises
        self.margin = margin
        self.oversample = oversample
        self.stats = dict(decisions=0, worlds=0, secs=0.0)

    def _candidates(self, g: Game, cands: list[int]) -> list[int]:
        if len(cands) <= 1:
            return list(cands)
        raises = [c for c in cands if c != PASS][:self.max_raises]
        # consider a statement jump too when a long runway exists
        big = [c for c in cands if c != PASS]
        if len(big) > self.max_raises:
            jump = big[min(len(big) - 1, self.max_raises + 2)]
            if jump not in raises:
                raises.append(jump)
        out = ([PASS] if PASS in cands else []) + raises
        return out

    def _base_world_game(self, g: Game, me: int, world: dict) -> Game:
        b = Game(dealer=g.dealer, win_score=g.win_score,
                 lose_score=g.lose_score)
        b.hand_number = g.hand_number
        b.scores = list(g.scores)
        b.phase = BIDDING
        b.turn = bid_lead(g.dealer)
        hands = [None] * 4
        hands[me] = list(g.hands[me])
        for s in SEATS:
            if s != me:
                hands[s] = list(world[s])
        b.hands = hands
        b.widow = list(world["widow"])
        for seat, bid in g.bid_history:
            b.bid(seat, bid)
        assert b.turn == me and b.phase == BIDDING
        return b

    @torch.no_grad()
    def bid(self, g: Game, me: int, cands: list[int]) -> int:
        options = self._candidates(g, cands)
        if len(options) == 1:
            return options[0]
        t0 = time.time()
        rng = random.Random((g.hand_number * 1_000_003)
                            ^ (len(g.bid_history) * 7919)
                            ^ hash(tuple(sorted(g.hands[me]))) & 0xFFFFFF)
        worlds = sample_worlds(g, me, self.worlds, self.listen, rng,
                               oversample=self.oversample)
        team = team_of(me)
        ev = {c: 0.0 for c in options}
        for world in worlds:
            base = self._base_world_game(g, me, world)
            for c in options:
                sim = base.clone()
                sim.bid(me, c)
                env = RolloutEnv(sim)
                while not env.done:
                    s, dt, cs = env.decision()
                    env.apply(model_choose(self.net, "cpu", env, s, dt, cs))
                if sim.phase == GAME_OVER:
                    p = 1.0 if sim.winner == team else 0.0
                else:
                    p = self.wp(sim.scores[team], sim.scores[1 - team],
                                sim.win_score, sim.lose_score)
                ev[c] += p
        self.stats["decisions"] += 1
        self.stats["worlds"] += len(worlds)
        self.stats["secs"] += time.time() - t0
        raises = [c for c in options if c != PASS]
        best_raise = max(raises, key=lambda c: ev[c]) if raises else PASS
        if PASS not in options:
            return best_raise
        # price-scaled discipline: cheap bids are low-risk options taken on
        # thin edges; expensive contracts must clearly beat folding
        floor = g.min_next_bid() or VALID_BIDS[-1]
        margin = self.margin * (0.25 + 0.75 * (floor - 65) / 55.0)
        k = len(worlds)
        if ev[best_raise] > ev[PASS] + margin * k:
            return best_raise
        return PASS


# ---------------------------------------------------------------------------
# The gate duel: oracle bids vs gen23's own bids, gen23 plays everything
# ---------------------------------------------------------------------------


@torch.no_grad()
def play_oracle_game(net, oracle: OracleBidder, pair_seed: int, flip: bool,
                     win_score: int = 500, lose_score: int = -250):
    env = SelfPlayGame(seed=pair_seed, deck_fn=deck_stream(pair_seed),
                       dealer=pair_seed % 4,
                       win_score=win_score, lose_score=lose_score)
    side0_team = 1 if flip else 0
    while not env.done:
        seat, dtype, cands = env.decision()
        if dtype == D_BID and team_of(seat) == side0_team:
            action = oracle.bid(env.g, seat, cands)
        else:
            action = model_choose(net, "cpu", env, seat, dtype, cands)
        env.apply(action)
    g = env.g
    diff0 = g.scores[side0_team] - g.scores[1 - side0_team]
    winner_side = 0 if g.winner == side0_team else 1
    stats = {0: dict(contracts=0, made=0, bid_sum=0),
             1: dict(contracts=0, made=0, bid_sum=0)}
    for h in g.hand_history:
        i = 0 if team_of(h[1]) == side0_team else 1
        stats[i]["contracts"] += 1
        stats[i]["made"] += 0 if h[6] else 1
        stats[i]["bid_sum"] += h[2]
    return winner_side, int(diff0), stats


_W: dict = {}


def _init_worker(net_path: str, worlds: int, listen: bool,
                 win: int, lose: int, margin: float, widen: float,
                 oversample: int):
    torch.set_num_threads(1)
    net = load_qnet(net_path)
    _W["net"] = net
    _W["oracle"] = OracleBidder(net, WinProb(), worlds=worlds, listen=listen,
                                margin=margin, widen=widen,
                                oversample=oversample)
    _W["win"], _W["lose"] = win, lose


def _run_pair(pair_seed: int):
    o = _W["oracle"].stats
    before = dict(o)
    out = []
    for flip in (False, True):
        w, d, st = play_oracle_game(_W["net"], _W["oracle"], pair_seed, flip,
                                    _W["win"], _W["lose"])
        out.append((w, d, st))
    delta = {k: o[k] - before[k] for k in o}
    return pair_seed, out, delta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", type=int, default=120)
    ap.add_argument("--worlds", type=int, default=12)
    ap.add_argument("--listen", type=int, default=1)
    ap.add_argument("--deaf", action="store_true",
                    help="shorthand for --listen 0 (ablation arm)")
    ap.add_argument("--net", default="models/gen23-cand1.pt")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--win-score", type=int, default=500)
    ap.add_argument("--lose-score", type=int, default=-250)
    ap.add_argument("--margin", type=float, default=0.02)
    ap.add_argument("--widen", type=float, default=1.5)
    ap.add_argument("--oversample", type=int, default=4)
    ap.add_argument("--dump", default=None)
    args = ap.parse_args()
    listen = bool(args.listen) and not args.deaf

    pair_seeds = [args.seed + p * 104729 + 31 for p in range(args.pairs)]
    done_pairs = set()
    dump_f = None
    if args.dump:
        import os
        if os.path.exists(args.dump):
            with open(args.dump) as f:
                for line in f:
                    try:
                        done_pairs.add(json.loads(line)["seed"])
                    except json.JSONDecodeError:
                        pass
            pair_seeds = [s for s in pair_seeds if s not in done_pairs]
            print(f"resume: {len(done_pairs)} pairs banked, "
                  f"{len(pair_seeds)} to play", flush=True)
        dump_f = open(args.dump, "a")

    a = b = 0
    pair_wins = []
    auct = {0: dict(contracts=0, made=0, bid_sum=0),
            1: dict(contracts=0, made=0, bid_sum=0)}
    osecs = odec = 0.0
    t0 = time.time()
    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    with ctx.Pool(args.workers, initializer=_init_worker,
                  initargs=(args.net, args.worlds, listen,
                            args.win_score, args.lose_score,
                            args.margin, args.widen,
                            args.oversample)) as pool:
        for n, (seed, games, ostats) in enumerate(
                pool.imap_unordered(_run_pair, pair_seeds), 1):
            pw = 0
            for w, d, st in games:
                if w == 0:
                    a += 1
                    pw += 1
                else:
                    b += 1
                for i in (0, 1):
                    for k2 in auct[i]:
                        auct[i][k2] += st[i][k2]
            pair_wins.append(pw)
            osecs += ostats["secs"]
            odec += ostats["decisions"]
            if dump_f:
                dump_f.write(json.dumps(
                    dict(seed=seed, wins=pw,
                         games=[[w, d] for w, d, _ in games])) + "\n")
                dump_f.flush()
            if n % 5 == 0:
                g = a + b
                print(f"  [{n}/{len(pair_seeds)} pairs] oracle {a}-{b} "
                      f"({a / g:.1%}), {osecs / max(1, odec):.2f}s/decision, "
                      f"{(time.time() - t0) / n:.0f}s/pair", flush=True)

    import statistics
    games = a + b
    npairs = len(pair_wins)
    se = (statistics.pstdev(pair_wins) / math.sqrt(npairs) / 2
          if npairs > 1 else 0.0)
    mode = "listen" if listen else "DEAF"
    print(f"\nAlphaBid oracle (K={args.worlds}, {mode}) vs gen23-bids — "
          f"{npairs} pairs ({games} games, duplicate decks, seats swapped):")
    print(f"  oracle: {a}/{games} = {a / games:.1%} ± {1.96 * se:.1%} "
          f"(95% CI, pair-level)")
    for i, name in ((0, "oracle"), (1, "gen23")):
        c = max(1, auct[i]["contracts"])
        print(f"  {name}: {auct[i]['contracts']} contracts, "
              f"made {auct[i]['made'] / c:.0%}, "
              f"avg bid {auct[i]['bid_sum'] / c:.1f}")


if __name__ == "__main__":
    main()
