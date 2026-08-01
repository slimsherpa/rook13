#!/usr/bin/env python3
"""Condense the widow-gym corpus into the artifact's data bundle.

    ~/torch-env/bin/python scripts/widowgym_summary.py

Reads every clean shard; writes runs/gen24/widowgym/summary.json:
  - baseline: gen23's declarer hand-score histogram + made%
  - explore: how many contracts/rollouts, uniform-random protocol facts
  - supply: per-contract BEST-of-samples advantage distribution — Riley's
    "we capture +X more points Y% of the time" table. This is hindsight
    opportunity (the ceiling a perfect selector could reach with these
    samples), clearly distinct from achieved-bot performance.
"""

import collections
import glob
import json
import os
import statistics
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

SUPPLY_BUCKETS = [(0, 0, "no better choice found"),
                  (5, 15, "+5 to +15"),
                  (20, 45, "+20 to +45"),
                  (50, 95, "+50 to +95"),
                  (100, 195, "+100 to +195"),
                  (200, 999, "+200 or more")]


def main():
    rows = []
    for p in glob.glob("runs/gen24/widowgym/shards/*.jsonl"):
        for line in open(p):
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if r["cands"] and "k" in r["cands"][0]:
                continue    # tagged-era row, excluded
            rows.append(r)
    n = len(rows)
    n_rollouts = sum(len(r["cands"]) for r in rows)

    base_hist = collections.Counter(
        max(-120, min(120, int(round(r["own"]["s"] / 10.0) * 10)))
        for r in rows)
    made = statistics.mean(r["own"]["m"] for r in rows)
    avg_score = statistics.mean(r["own"]["s"] for r in rows)

    best_adv = [max(c["adv"] for c in r["cands"]) for r in rows]
    supply = []
    for lo, hi, label in SUPPLY_BUCKETS:
        if lo == 0:
            c = sum(1 for a in best_adv if a <= 0)
        else:
            c = sum(1 for a in best_adv if lo <= a <= hi)
        supply.append(dict(label=label, n=c, pct=round(c / n, 4)))
    mean_ceiling = statistics.mean(max(0, a) for a in best_adv)

    allc = [c for r in rows for c in r["cands"]]
    single_beat = sum(1 for c in allc if c["adv"] > 0) / len(allc)
    single_tie = sum(1 for c in allc if c["adv"] == 0) / len(allc)

    out = dict(
        n_contracts=n, n_rollouts=n_rollouts,
        baseline=dict(hist={str(k): v for k, v in sorted(base_hist.items())},
                      made=round(made, 4), avg_score=round(avg_score, 2)),
        supply=supply,
        mean_ceiling=round(mean_ceiling, 2),
        single_random=dict(beat=round(single_beat, 4),
                           tie=round(single_tie, 4)),
    )
    path = "runs/gen24/widowgym/summary.json"
    with open(path, "w") as f:
        json.dump(out, f)
    print(f"{n:,} contracts, {n_rollouts:,} rollouts -> {path}")
    for s in supply:
        print(f"  {s['label']:>24}: {s['pct']:.1%}")
    print(f"  mean ceiling: +{mean_ceiling:.1f} pts/contract")


if __name__ == "__main__":
    main()
