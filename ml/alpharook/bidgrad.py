"""Bidding graduation: the gym bidder faces real Rook.

The candidate bids with the gym-trained BidNet; gen13 plays every other
decision (widow, trump, all nine tricks). Opponent: pure gen13. Duplicate
decks, seats swapped. Two exams:

  1. open play  — games from 0-0 (sprint and marathon)
  2. endgame    — games starting at the guard's score states; the learned
                  bidder must approach the proven guard win-rates
                  (495v300: 94.2% guarded vs 90.7% unguarded, etc.)

    python -m alpharook.bidgrad --bidder runs/bid-floor/best.pt --pairs 150
    python -m alpharook.bidgrad --bidder runs/bid-floor/best.pt \
        --start-my 495 --start-opp 300 --pairs 300
"""

from __future__ import annotations

import argparse
import time

import numpy as np
import torch

from rook.cards import team_of
from rook.engine import BIDDING
from .encoder import D_BID
from .env import SelfPlayGame
from .model import load_qnet
from .duel import deck_stream
from .graduation import reflex, play_game
from .bidgym import load_bidnet, bid_state, act_vec


class BidSwap:
    """gen13 everywhere, except the auction belongs to the gym bidder."""

    def __init__(self, bidnet, player):
        self.bidnet = bidnet
        self.player = player

    def pick(self, env, seat, dtype, cands) -> int:
        g = env.g
        if self.bidnet is not None and dtype == D_BID and g.phase == BIDDING:
            if len(cands) == 1:
                return 0
            s = bid_state(g, seat, g.scores, g.win_score, g.lose_score,
                          g.hand_number)
            S = torch.from_numpy(np.stack([s] * len(cands)))
            A = torch.from_numpy(np.stack([act_vec(b) for b in cands]))
            with torch.no_grad():
                return int(self.bidnet(S, A).argmax().item())
        return reflex(self.player, env, seat, dtype, cands)


def play_from(composite, opponent, pair_seed, flip, win_score, start):
    """play_game with injected starting scores (endgame exam)."""
    env = SelfPlayGame(seed=pair_seed, deck_fn=deck_stream(pair_seed),
                       dealer=pair_seed % 4,
                       win_score=win_score, lose_score=-win_score // 2)
    comp_team = 1 if flip else 0
    if start != (0, 0):
        env.g.scores = [start[0], start[1]] if comp_team == 0 \
            else [start[1], start[0]]
    while not env.done:
        seat, dtype, cands = env.decision()
        if team_of(seat) == comp_team:
            j = composite.pick(env, seat, dtype, cands)
        else:
            j = reflex(opponent, env, seat, dtype, cands)
        env.apply(cands[j])
    s = env.g.scores
    return (1 if env.g.winner == comp_team else 0,
            s[comp_team] - s[1 - comp_team])


_W: dict = {}


def _init(d):
    torch.set_num_threads(1)
    bn = None if d["bidder"] == "BASELINE" else load_bidnet(d["bidder"])
    _W["comp"] = BidSwap(bn, load_qnet(d["player"]))
    _W["opp"] = load_qnet(d["opponent"])
    _W["win"] = d["win_score"]
    _W["start"] = d["start"]


def _pair(seed):
    return [play_from(_W["comp"], _W["opp"], seed, flip, _W["win"],
                      _W["start"]) for flip in (False, True)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bidder", required=True,
                    help="BidNet checkpoint, or BASELINE for gen13's own bidding (the reference at any start state)")
    ap.add_argument("--player", default="models/gen13.pt")
    ap.add_argument("--opponent", default="models/gen13.pt")
    ap.add_argument("--pairs", type=int, default=150)
    ap.add_argument("--win-score", type=int, default=500)
    ap.add_argument("--start-my", type=int, default=0)
    ap.add_argument("--start-opp", type=int, default=0)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--workers", type=int, default=7)
    args = ap.parse_args()

    d = dict(bidder=args.bidder, player=args.player, opponent=args.opponent,
             win_score=args.win_score, start=(args.start_my, args.start_opp))
    seeds = [args.seed + p * 104729 + 1 for p in range(args.pairs)]
    wins = games = sweeps = osweeps = 0
    diffs = []
    t0 = time.time()
    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    with ctx.Pool(args.workers, initializer=_init, initargs=(d,)) as pool:
        for res in pool.imap_unordered(_pair, seeds):
            pw = 0
            for w, df in res:
                wins += w; pw += w; games += 1; diffs.append(df)
            sweeps += pw == 2
            osweeps += pw == 0
            if games % 40 == 0:
                print(f"  [{games // 2}/{args.pairs}] {wins}-{games - wins} "
                      f"({wins / games:.1%}) sweeps {sweeps}-{osweeps} "
                      f"{(time.time() - t0) / games:.2f}s/g", flush=True)
    tag = (f"start {args.start_my}-{args.start_opp}"
           if (args.start_my, args.start_opp) != (0, 0) else "open play")
    print(f"BIDSWAP({args.bidder}) vs gen13 — {args.pairs} pairs, {tag}, "
          f"win-score {args.win_score}:")
    print(f"  {wins / games:.1%} wins (avg diff {sum(diffs) / games:+.1f}), "
          f"sweeps {sweeps}-{osweeps}")


if __name__ == "__main__":
    main()
