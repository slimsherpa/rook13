#!/usr/bin/env python3
"""P1.1 smoke-duel verdict: AnytimeRook (A) vs flat-K48 MortalRook (B).

Per-hand currency, mirrored-pair deal-luck cancellation — the K-ladder's
own arithmetic: consecutive dump lines within a shard are the two games
of one duplicate-deck pair; hand k in both games is the SAME deal, so
d_k = (diff_A_game1[k] + diff_A_game2[k]) / 2 is the deal-neutral A edge
for that deal. The gate is 'at least matches flat-K48': the anytime
searcher passes unless B is significantly ahead.

Usage: p11_report.py <shard.jsonl|dir> [...]   (+ optional --think dir)
"""
import json
import math
import statistics as st
import sys
from collections import defaultdict
from pathlib import Path


def main():
    args = [a for a in sys.argv[1:] if a != "--think"]
    think_dirs = []
    if "--think" in sys.argv:
        i = sys.argv.index("--think")
        think_dirs = [sys.argv[i + 1]]
        args = [a for a in sys.argv[1:] if a not in ("--think",
                                                     sys.argv[i + 1])]
    files = []
    for a in args:
        p = Path(a)
        files += sorted(p.glob("p11smoke*.jsonl")) if p.is_dir() else [p]

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

    # per-hand, deal-paired
    ds = []
    for g1, g2 in pairs:
        for h1, h2 in zip(g1["hh"], g2["hh"]):
            ds.append((h1[3] + h2[3]) / 2.0)
    m = st.mean(ds)
    ci = 1.96 * st.pstdev(ds) / math.sqrt(len(ds))

    print("P1.1 SMOKE — A = AnytimeRook(x1.0)  B = MortalRook flat-K48")
    print(f"{len(files)} shards, {n} games ({len(pairs)} mirrored pairs, "
          f"{sum(g['hands'] for g in games):,} hands)\n")
    print(f"  A win rate : {wr:.1%} ({a_wins}-{n - a_wins})  "
          f"95% CI {wr - 1.96 * se_w:.1%}..{wr + 1.96 * se_w:.1%}")
    print(f"  pts/hand   : {m:+.2f} ± {ci:.2f} for A "
          f"(paired deals, n={len(ds):,})")
    ac = sum(g["a_contracts"] for g in games)
    am = sum(g["a_made"] for g in games)
    bc = sum(g["b_contracts"] for g in games)
    bm = sum(g["b_made"] for g in games)
    print(f"  auctions   A: {ac} contracts {am / max(ac, 1):.0%} made | "
          f"B: {bc} contracts {bm / max(bc, 1):.0%} made")

    print("\nPRE-REGISTERED GATE (charter P1.1, set before results):")
    print("  A - B pts/hand CI overlapping or above zero -> PASS "
          "(anytime at least matches flat-K48)")
    print("  A significantly BELOW zero -> investigate stopping rules "
          "before P1.2")
    lo = m - ci
    verdict = ("PASS — anytime matches or beats flat-K48" if lo >= 0 or
               m >= 0 else
               ("PASS (statistical tie)" if m + ci >= 0 else
                "FAIL — flat-K48 significantly ahead"))
    if lo > 0:
        verdict = "PASS — anytime BEATS flat-K48 (CI clear of zero)"
    print(f"\n  => {verdict}")

    for d in think_dirs:
        rows = []
        for f in Path(d).glob("think_box*.jsonl.*"):
            rows += [json.loads(l) for l in open(f) if l.strip()]
        if not rows:
            continue
        by = defaultdict(list)
        for r in rows:
            key = ("lead" if (r["trick"] == 0 and r["lead"])
                   else f"t{min(r['trick'], 4)}{'+' if r['trick'] >= 4 else ''}")
            by[key].append(r)
        print(f"\nTHINK TELEMETRY ({len(rows):,} searched decisions):")
        order = ["lead", "t0", "t1", "t2", "t3", "t4+"]
        for k in order:
            v = by.get(k)
            if not v:
                continue
            ks = sorted(x["k"] for x in v)
            secs = sorted(x["secs"] for x in v)
            stops = defaultdict(int)
            for x in v:
                stops[x["stop"]] += 1
            ovr = sum(x["overrode"] for x in v)
            tmo = sum(x["timeouts"] for x in v)
            print(f"  {k:4s} n={len(v):6,} K med={ks[len(ks) // 2]:3d} "
                  f"p90={ks[int(len(ks) * .9)]:3d} max={ks[-1]:3d}  "
                  f"secs med={secs[len(secs) // 2]:6.2f} "
                  f"p90={secs[int(len(secs) * .9)]:6.2f}  "
                  f"ovr {ovr / len(v):5.1%}  tmo/dec {tmo / len(v):.2f}  "
                  f"{dict(stops)}")


if __name__ == "__main__":
    main()
