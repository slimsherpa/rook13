"""Riley's luck-vs-skill hand decomposition (2026-07-25).

With duplicate decks and swapped seats, hand k of both games in a pair is
the SAME deal held by opposite players. For each aligned hand-pair, exactly
one of:

  CARDS DECIDED  — the same card-holding side won the hand in both mirrors
                   (whoever got the lucky cards won; skill didn't matter)
  A BOTH         — side A (gen21) won the hand in BOTH mirrors — it won
                   holding the strong cards AND holding the weak ones
  B BOTH         — side B won both mirrors regardless of cards
  TIE-ISH        — at least one mirror split the hand points evenly

"Won the hand" = larger score delta that hand (set penalties included —
this is the delta that moves the game). Caveat: cards are identical across
mirrors but score CONTEXT can drift (one mirror may reach an endgame the
other doesn't), so bids can differ; this is the honest per-hand read of
"same cards, different player" under real game conditions.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path


def main() -> None:
    path = Path(sys.argv[1])
    recs = [json.loads(l) for l in open(path) if l.strip()]
    n_pairs = len(recs) // 2
    cards = a_both = b_both = tie = 0
    a_both_diff = []
    cards_diff = []
    for p in range(n_pairs):
        g1, g2 = recs[2 * p], recs[2 * p + 1]
        for h1, h2 in zip(g1["hh"], g2["hh"]):
            d1, d2 = h1[3], h2[3]           # diff for A in each mirror
            if d1 == 0 or d2 == 0:
                tie += 1
            elif d1 > 0 and d2 > 0:
                a_both += 1                  # A won holding either side
                a_both_diff.append((d1 + d2) / 2)
            elif d1 < 0 and d2 < 0:
                b_both += 1
            else:
                cards += 1                   # same card-set won both mirrors
                cards_diff.append(abs(d1 - d2) / 2)
    total = cards + a_both + b_both + tie
    print(f"{path.name}: {n_pairs} pairs, {total} aligned hand-pairs")
    print(f"  cards decided (lucky hand won):  {cards:>7}  {cards/total:.1%}")
    print(f"  gen21 won no matter what:        {a_both:>7}  {a_both/total:.1%}")
    print(f"  opponent won no matter what:     {b_both:>7}  {b_both/total:.1%}")
    print(f"  tied hand in a mirror:           {tie:>7}  {tie/total:.1%}")
    if a_both + b_both:
        skill = a_both / (a_both + b_both)
        se = math.sqrt(skill * (1 - skill) / (a_both + b_both))
        print(f"  skill-decided hands going to gen21: {skill:.1%} ±{1.96*se:.1%}")
    if a_both_diff:
        print(f"  avg swing when gen21 won both:   {sum(a_both_diff)/len(a_both_diff):+.0f} pts")


if __name__ == "__main__":
    main()
