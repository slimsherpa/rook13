#!/usr/bin/env python3
"""Per-matchup stat pack for every gauntlet dump -> one JSON."""
import glob
import json
import os
from collections import Counter

os.chdir("/root/rook13/ml/runs/gauntlet")
out = {}
for f in sorted(glob.glob("*.jsonl")):
    seen = set()
    n = wins = hands = 0
    ssum = {"A": 0, "B": 0}
    shist = {"A": Counter(), "B": Counter()}
    bids = {"A": Counter(), "B": Counter()}
    sets = {"A": Counter(), "B": Counter()}
    sweeps = {}
    ws = []          # mirror games land as consecutive line-pairs
    for line in open(f):
        try:
            r = json.loads(line)
        except Exception:
            continue
        if "seed" in r:
            k = (r["seed"], r["flip"])
            if k in seen:
                continue
            seen.add(k)
        ws.append(r["w"])
        n += 1
        wins += 1 if r["w"] == 0 else 0
        hands += r["hands"]
        ssum["A"] += r["a"]
        ssum["B"] += r["b"]
        shist["A"][r["a"] // 125 * 125] += 1
        shist["B"][r["b"] // 125 * 125] += 1
        for bidder, bid, made, _ in r["hh"]:
            side = "A" if bidder == 0 else "B"
            bids[side][bid] += 1
            if not made:
                sets[side][bid] += 1
    if not n:
        continue
    pw = list(zip(ws[0::2], ws[1::2]))
    m = dict(n=n, hands=hands, win=round(wins / n * 100, 1),
             sweeps_a=sum(1 for p in pw if p == (0, 0)),
             sweeps_b=sum(1 for p in pw if p == (1, 1)),
             pairs=len(pw),
             avg=dict(A=round(ssum["A"] / n), B=round(ssum["B"] / n)),
             hist={s: dict(sorted(shist[s].items())) for s in "AB"})
    for s in "AB":
        tot = sum(bids[s].values())
        m[f"bids_{s}"] = {b: dict(c=bids[s][b], set=sets[s][b])
                          for b in sorted(bids[s])}
        m[f"avg_bid_{s}"] = round(sum(b * c for b, c in bids[s].items())
                                  / tot, 1) if tot else 0
        m[f"contracts_{s}"] = tot
        m[f"set_{s}"] = round(sum(sets[s].values()) / tot * 100, 1) \
            if tot else 0
    out[f.replace(".jsonl", "")] = m
json.dump(out, open("/root/status/gauntlet_report.json", "w"))
print("matchups:", len(out))
