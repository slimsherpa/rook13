#!/usr/bin/env python3
"""Pool duel --dump shards from the fleet into one verdict.

Games are written two-per-pair (same deal, seats swapped), so consecutive
line pairs within a shard are a mirrored pair. Incomplete trailing pairs
are dropped — a half-pair is exactly the kind of unbalanced sample the
mirror exists to prevent.

Reports the win rate with a confidence interval so the answer is a range,
not a point estimate that invites over-reading.

Usage: duel_dump_report.py <shard.jsonl> [...]
"""
import json
import math
import statistics as st
import sys
from pathlib import Path


def main():
    args = sys.argv[1:]
    files = []
    for a in args:
        p = Path(a)
        files += sorted(p.glob("*.jsonl")) if p.is_dir() else [p]

    games, pairs = [], []
    for f in files:
        rows = [json.loads(l) for l in open(f) if l.strip()]
        games += rows
        for i in range(0, len(rows) - 1, 2):     # drop a trailing half-pair
            pairs.append((rows[i], rows[i + 1]))

    if not games:
        sys.exit("no games")
    n = len(games)
    a_wins = sum(1 for g in games if g["w"] == 0)
    wr = a_wins / n
    se = math.sqrt(wr * (1 - wr) / n)
    z = (wr - 0.5) / se if se else 0.0
    p = 0.5 * math.erfc(z / math.sqrt(2))

    print(f"A = trick-1 teacher   B = trick-3 teacher")
    print(f"{len(files)} shards, {n:,} games ({len(pairs):,} complete "
          f"mirrored pairs)\n")
    print(f"  A win rate : {wr:.1%}   ({a_wins}-{n - a_wins})")
    print(f"  95% CI     : {wr - 1.96 * se:.1%} .. {wr + 1.96 * se:.1%}")
    print(f"  z = {z:.2f}   p(one-sided) = {p:.4f}"
          f"   {'SIGNIFICANT' if p < 0.05 else 'not significant'}")

    sw_a = sum(1 for x, y in pairs if x["w"] == 0 and y["w"] == 0)
    sw_b = sum(1 for x, y in pairs if x["w"] == 1 and y["w"] == 1)
    print(f"  sweeps     : A {sw_a} - B {sw_b}  "
          f"(split {len(pairs) - sw_a - sw_b})")

    diffs = [g["a"] - g["b"] for g in games]
    print(f"  avg margin : {st.mean(diffs):+.1f} points per game")
    print(f"  hands/game : {st.mean([g['hands'] for g in games]):.1f}")

    ac = sum(g["a_contracts"] for g in games)
    am = sum(g["a_made"] for g in games)
    bc = sum(g["b_contracts"] for g in games)
    bm = sum(g["b_made"] for g in games)
    ab = sum(g["a_bids"] for g in games)
    bb = sum(g["b_bids"] for g in games)
    print(f"\n  auctions   A: {ac:,} contracts, {am / max(ac,1):.0%} made, "
          f"avg bid {ab / max(ac,1):.1f}")
    print(f"             B: {bc:,} contracts, {bm / max(bc,1):.0%} made, "
          f"avg bid {bb / max(bc,1):.1f}")
    print("  (identical auctions => any edge is CARD PLAY, the fingerprint"
          "\n   every real search gain in this project has had)")

    print(f"\nPRE-REGISTERED DECISION RULE (set before any result was seen):")
    print(f"  >= 55%  -> real rung: switch the teacher to trick-1, treat the"
          f"\n             banked corpus as a warm-up batch")
    print(f"  52-55%  -> suggestive but under-powered at this n: extend the"
          f"\n             run rather than guess")
    print(f"  <  52%  -> trick-3 stays, question closed, corpus continues")
    verdict = ("SWITCH TO TRICK-1" if wr >= 0.55 else
               "EXTEND — ambiguous" if wr >= 0.52 else
               "KEEP TRICK-3")
    print(f"\n  => {verdict}")


if __name__ == "__main__":
    main()
