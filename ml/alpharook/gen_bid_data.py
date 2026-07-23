"""Outcome-model data for the BIDDING GYM (Riley's design, 2026-07-23).

Rook is a bidding game, then an execution game — so train bidding at
auction speed: instead of playing 9 tricks per hand, a learned OUTCOME
MODEL will answer "a hand like this, as declarer, captures this many
points" and the bidder plays millions of score-race auctions against it.

This script generates that model's food: full hands played by all-gen13
reflex (the shipped execution engine), recording per hand the declarer's
dealt 9 cards, the widow, the chosen trump + go-down, and the raw points
each team captured. Forced-dealer contracts (the hot-seat gym's auction)
sample the FULL hand-strength spectrum — including the junk hands a
score-aware bidder must know the cost of taking.

    python -m alpharook.gen_bid_data --seed 1 --out runs/biddata/s1.jsonl
"""

from __future__ import annotations

import argparse
import json

from .model import load_qnet
from .encoder import D_BID
from .hotseat import HotSeatGame, scripted_bid, reflex_pick


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--net", default="models/gen13.pt")
    ap.add_argument("--hands", type=int, default=10_000_000)
    args = ap.parse_args()

    import torch
    torch.set_num_threads(1)
    net = load_qnet(args.net)
    written = 0
    episode = 0
    with open(args.out, "a") as f:
        while written < args.hands:
            env = HotSeatGame(args.seed * 1_000_003 + episode,
                              win_score=10 ** 9, lose_score=-(10 ** 9))
            episode += 1
            hands_meta = []  # (dealer, dealt9, widow, trump, godown)
            while len(env.hand_points) < 12 and not env.done:
                seat, dtype, cands = env.decision()
                g = env.g
                if dtype == D_BID:
                    if len(hands_meta) == len(env.hand_points):
                        hands_meta.append({
                            "dealt": sorted(g.hands[g.dealer]),
                            "widow": sorted(g.widow),
                        })
                    env.apply(scripted_bid(env, cands))
                    continue
                env.apply(cands[reflex_pick(net, env, seat, dtype, cands)])
            for i, (dealer, p0, p1) in enumerate(env.hand_points):
                m = hands_meta[i] if i < len(hands_meta) else {}
                rec = {"dealt": m.get("dealt"), "widow": m.get("widow"),
                       "decl_pts": (p0, p1)[dealer % 2],
                       "def_pts": (p0, p1)[1 - dealer % 2]}
                f.write(json.dumps(rec) + "\n")
                written += 1
            if written % 50000 < 12:
                f.flush()
                print(f"{written} hands", flush=True)


if __name__ == "__main__":
    main()
