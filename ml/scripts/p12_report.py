#!/usr/bin/env python3
"""P1.2 house-battery verdict: AnytimeRook (A) vs COSMO (B) — the gate
that freezes the new card core.

Same paired-deal arithmetic as the K-ladder and p11_report: consecutive
dump lines in a shard are one duplicate-deck pair; hand k in both games
is the same deal.

PRE-REGISTERED GATE (charter P1.2, set before any result):
  pts/hand CI for A clear of zero  -> PASS: freeze AnytimeRook as the
                                      new card core (expected +1.5-2+)
  CI straddles zero                -> extend the run (per-hand currency
                                      resolves ~10x faster than win%;
                                      keep grinding before judging)
  CI clear BELOW zero              -> FAIL: autopsy before P2/P3

Usage: p12_report.py <shard.jsonl|dir> [...]
"""
import json
import math
import statistics as st
import sys
from pathlib import Path


def main():
    files = []
    for a in sys.argv[1:]:
        p = Path(a)
        files += sorted(p.glob("p12battery*.jsonl")) if p.is_dir() else [p]
    games, pairs = [], []
    for f in files:
        rows = [json.loads(l) for l in open(f) if l.strip()]
        games += rows
        for i in range(0, len(rows) - 1, 2):
            pairs.append((rows[i], rows[i + 1]))
    if not pairs:
        sys.exit("no complete pairs yet")

    n = len(games)
    a_wins = sum(1 for g in games if g["w"] == 0)
    wr = a_wins / n
    se_w = math.sqrt(max(wr * (1 - wr), 1e-9) / n)
    ds = []
    for g1, g2 in pairs:
        for h1, h2 in zip(g1["hh"], g2["hh"]):
            ds.append((h1[3] + h2[3]) / 2.0)
    m = st.mean(ds)
    ci = 1.96 * st.pstdev(ds) / math.sqrt(len(ds))

    print("P1.2 BATTERY — A = AnytimeRook(x1.0)  B = Cosmo (gen21xbeliefxt0)")
    print(f"{len(files)} shards, {n} games ({len(pairs)} pairs, "
          f"{sum(g['hands'] for g in games):,} hands)\n")
    print(f"  A win rate : {wr:.1%} ({a_wins}-{n - a_wins})  "
          f"95% CI {wr - 1.96 * se_w:.1%}..{wr + 1.96 * se_w:.1%}")
    print(f"  pts/hand   : {m:+.2f} ± {ci:.2f} for A "
          f"(paired deals, n={len(ds):,})")
    ac = sum(g["a_contracts"] for g in games)
    am = sum(g["a_made"] for g in games)
    bc = sum(g["b_contracts"] for g in games)
    bm = sum(g["b_made"] for g in games)
    ab = sum(g["a_bids"] for g in games)
    bb = sum(g["b_bids"] for g in games)
    print(f"  auctions   A: {ac} contracts {am / max(ac, 1):.0%} made "
          f"avg bid {ab / max(ac, 1):.1f}")
    print(f"             B: {bc} contracts {bm / max(bc, 1):.0%} made "
          f"avg bid {bb / max(bc, 1):.1f}")
    print("  (identical auctions expected => any edge is card play)")

    lo, hi = m - ci, m + ci
    verdict = ("PASS — CI clear of zero: FREEZE AnytimeRook as the new "
               "card core" if lo > 0 else
               "FAIL — CI clear below zero: autopsy before P2/P3"
               if hi < 0 else
               f"EXTEND — CI straddles zero ({lo:+.2f}..{hi:+.2f}); "
               "keep grinding")
    print(f"\n  => {verdict}")


if __name__ == "__main__":
    main()
