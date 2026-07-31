#!/usr/bin/env python3
"""BidBrain first read: preliminary gate + full auction distributions.

    ~/torch-env/bin/python scripts/bidbrain_firstread.py --pairs 300 \
        --brain models/bidbrain-v0.pt

Writes runs/gen24/bidbrain/firstread.json: win rate w/ pair-level CI,
all-bid histograms, winning-bid histograms, made% by level — for both
the brain side and the gen23 house. (Preliminary: the crowning gate is
1,000 pairs on the final model, per law 2 as extended.)
"""

import argparse
import json
import math
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import torch  # noqa: E402


def _init(net_path, brain_path):
    torch.set_num_threads(1)
    from alpharook.model import load_qnet
    from alpharook.bidbrain import BrainBidder
    global _NET, _BRAIN
    _NET = load_qnet(net_path)
    _BRAIN = BrainBidder(brain_path)


def _pair(seed):
    from alpharook.bidcity import play_bid_game
    out = []
    for flip in (False, True):
        w, d, st, hands = play_bid_game(_NET, _BRAIN, None, seed, flip)
        out.append((w, d, st, hands))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", type=int, default=300)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--brain", default="models/bidbrain-v0.pt")
    ap.add_argument("--net", default="models/gen23-cand1.pt")
    ap.add_argument("--tag", default="v0")
    args = ap.parse_args()

    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    seeds = [913 + p * 104729 for p in range(args.pairs)]
    a = b = 0
    pw = []
    # distributions: side 0 = brain, 1 = house
    all_bids = {0: {}, 1: {}}
    win_bids = {0: {}, 1: {}}
    made_by = {0: {}, 1: {}}
    pass_ct = {0: 0, 1: 0}
    turn_ct = {0: 0, 1: 0}
    t0 = time.time()
    with ctx.Pool(args.workers, initializer=_init,
                  initargs=(args.net, args.brain)) as pool:
        for n, games in enumerate(pool.imap_unordered(_pair, seeds), 1):
            wins_pair = 0
            for w, d, st, hands in games:
                if w == 0:
                    a += 1
                    wins_pair += 1
                else:
                    b += 1
                for h in hands:
                    for side, action, floor in h["bids"]:
                        turn_ct[side] += 1
                        if action == 0:
                            pass_ct[side] += 1
                        else:
                            all_bids[side][action] = \
                                all_bids[side].get(action, 0) + 1
                    if "bidder" in h:
                        s, bid = h["bidder"], h["bid"]
                        win_bids[s][bid] = win_bids[s].get(bid, 0) + 1
                        m = made_by[s].setdefault(bid, [0, 0])
                        m[0] += 1
                        m[1] += 0 if h["set"] else 1
            pw.append(wins_pair)
            if n % 50 == 0:
                print(f"  [{n}/{args.pairs}] brain {a}-{b} "
                      f"({a / (a + b):.1%})", flush=True)

    se = statistics.pstdev(pw) / math.sqrt(len(pw)) / 2
    games = a + b
    out = dict(tag=args.tag, pairs=args.pairs, games=games,
               brain_wins=a, rate=a / games, ci95=1.96 * se,
               all_bids=all_bids, win_bids=win_bids, made_by=made_by,
               pass_rate={s: pass_ct[s] / max(1, turn_ct[s]) for s in (0, 1)},
               secs=round(time.time() - t0))
    path = f"runs/gen24/bidbrain/firstread_{args.tag}.json"
    with open(path, "w") as f:
        json.dump(out, f)
    print(f"\nBIDBRAIN {args.tag} vs gen23 house — {args.pairs} pairs "
          f"({games} games): {a}/{games} = {a/games:.1%} ± {1.96*se:.1%}")
    for s, name in ((0, "brain"), (1, "house")):
        tot = sum(win_bids[s].values())
        top = sorted(win_bids[s].items(), key=lambda kv: -kv[1])[:4]
        print(f"  {name}: pass {out['pass_rate'][s]:.0%}, "
              f"{tot} contracts, top winning bids "
              f"{[(k, v) for k, v in top]}")
    print(f"-> {path}")


if __name__ == "__main__":
    main()
