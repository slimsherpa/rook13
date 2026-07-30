#!/usr/bin/env python3
"""Per-HAND analysis of a duel dump — the level below win rates.

A duel game is ~68 hands, so a 750-game run holds ~51,000 hands. Win rate
throws almost all of that away. This reads the per-hand records instead.

Two things become visible only at this level:

  LUCK vs SKILL (Riley's decomposition). Hand k of both games in a pair is
  the SAME DEAL held by opposite sides. If the same side wins it from both
  chairs, skill decided it; if each side wins it once, the cards did. The
  share of skill-decided hands a side takes is the cleanest measure of
  play strength this project has.

  WHERE the edge lives. Bidding is separable from play: who buys the
  contract, at what level, and who actually brings it home. An edge that
  shows up in make-rate at identical bid levels is a card-play edge, not
  an auction edge.

Usage: hand_analysis.py <dir-or-files>   [A = the searching stack]
"""
import json
import math
import statistics as st
import sys
from collections import defaultdict
from pathlib import Path


def load_pairs(files):
    """[(game1, game2)] — consecutive lines within a shard are a mirror."""
    pairs = []
    for f in files:
        rows = [json.loads(l) for l in open(f) if l.strip()]
        for i in range(0, len(rows) - 1, 2):
            pairs.append((rows[i], rows[i + 1]))
    return pairs


def main():
    args = sys.argv[1:]
    files = []
    for a in args:
        p = Path(a)
        files += sorted(p.glob("*.jsonl")) if p.is_dir() else [p]
    pairs = load_pairs(files)
    hands = [h for g1, g2 in pairs for h in g1["hh"] + g2["hh"]]
    n_hands = len(hands)
    print(f"{len(pairs):,} mirrored pairs   {n_hands:,} hands\n")

    # ---- 1. luck vs skill ------------------------------------------------
    cards = a_both = b_both = tie = 0
    a_swing, b_swing = [], []
    for g1, g2 in pairs:
        for h1, h2 in zip(g1["hh"], g2["hh"]):
            d1, d2 = h1[3], h2[3]
            if d1 == 0 or d2 == 0:
                tie += 1
            elif d1 > 0 and d2 > 0:
                a_both += 1
                a_swing.append(d1 + d2)
            elif d1 < 0 and d2 < 0:
                b_both += 1
                b_swing.append(-(d1 + d2))
            else:
                cards += 1
    aligned = cards + a_both + b_both + tie
    skill = a_both + b_both
    share = a_both / skill if skill else 0
    se = math.sqrt(share * (1 - share) / skill) if skill else 0
    print("LUCK vs SKILL  (same deal, both chairs)")
    print(f"  aligned hand-pairs        {aligned:,}")
    print(f"  cards decided it          {cards / aligned:6.1%}"
          f"   ({cards:,})")
    print(f"  skill decided it          {skill / aligned:6.1%}"
          f"   ({skill:,})")
    print(f"  ties                      {tie / aligned:6.1%}")
    print(f"\n  of the SKILL hands, A took {share:.1%}"
          f"  +/-{1.96 * se * 100:.1f}pp"
          f"   (gen21's own edge over Puma was 53-54%)")
    if a_swing:
        print(f"  avg swing when A takes one  {st.mean(a_swing):+.0f} pts")
    if b_swing:
        print(f"  avg swing when B takes one  {st.mean(b_swing):+.0f} pts")

    # ---- 2. the auction --------------------------------------------------
    print("\nTHE AUCTION")
    tot = defaultdict(lambda: [0, 0, 0])     # side -> [contracts, made, bidsum]
    for h in hands:
        side, bid, made, _d = h
        tot[side][0] += 1
        tot[side][1] += made
        tot[side][2] += bid
    for side, label in ((0, "A (search)"), (1, "B (gen21)")):
        c, m, b = tot[side]
        if c:
            print(f"  {label:12s} bought {c:6,} contracts "
                  f"({c / n_hands:5.1%} of hands)   made {m / c:5.1%}   "
                  f"avg bid {b / c:.1f}")

    # ---- 3. make rate by bid level — the card-play tell -------------------
    print("\nMAKE RATE BY BID LEVEL  (same bid, different declarer)")
    lvl = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    for side, bid, made, _d in hands:
        b = min(120, max(65, bid))
        lvl[b][side][0] += 1
        lvl[b][side][1] += made
    print(f"  {'bid':>5} {'A n':>7} {'A made':>8} {'B n':>7} {'B made':>8}"
          f" {'gap':>7}")
    for b in sorted(lvl):
        a_n, a_m = lvl[b][0]
        b_n, b_m = lvl[b][1]
        if a_n < 25 or b_n < 25:
            continue
        ra, rb = a_m / a_n, b_m / b_n
        print(f"  {b:>5} {a_n:>7,} {ra:>7.1%} {b_n:>7,} {rb:>7.1%}"
              f" {ra - rb:>+7.1%}")

    # ---- 4. what a hand is worth ----------------------------------------
    diffs = [h[3] for h in hands]
    a_win = sum(1 for d in diffs if d > 0)
    b_win = sum(1 for d in diffs if d < 0)
    print(f"\nPER-HAND OUTCOME")
    print(f"  A wins the hand           {a_win / n_hands:6.1%}")
    print(f"  B wins the hand           {b_win / n_hands:6.1%}")
    print(f"  even                      "
          f"{(n_hands - a_win - b_win) / n_hands:6.1%}")
    print(f"  mean swing per hand       {st.mean(diffs):+.1f} pts for A")
    print(f"  median |swing|            {st.median([abs(d) for d in diffs]):.0f} pts")

    # ---- 5. defence: who gets set ---------------------------------------
    print("\nSETS")
    for side, label in ((0, "A"), (1, "B")):
        c, m, _b = tot[side]
        if c:
            print(f"  {label} went set          {1 - m / c:6.1%} of its contracts"
                  f"   ({c - m:,} times)")


if __name__ == "__main__":
    main()
