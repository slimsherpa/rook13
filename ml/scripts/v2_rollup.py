#!/usr/bin/env python3
"""Morning rollup: v2 gate verdict + v1 comparison + telemetry.

- Headline: paired Gardner-v2 minus vanilla, pts/hand, vs the
  pre-registered lines (ship-eligible >= -1.0).
- Mechanism bar: v2 partner-lead divergent-hand cost must beat v1's
  -2.12 (both gates ran the same seed formula; deals are matched
  across runs by auction fingerprint — the bid sequence is play-
  independent, so it identifies the deal).
- Telemetry: merit / tiebreak / override counts and costs.

    ~/torch-env/bin/python scripts/v2_rollup.py
"""

import json
import math
import glob
from collections import Counter


def load(path):
    rows = [json.loads(l) for l in open(path)]
    n = len(rows) - (len(rows) % 2)
    return rows[:n]


def headline(rows):
    pairs = [(rows[i], rows[i + 1]) for i in range(0, len(rows), 2)]
    pv = []
    for g1, g2 in pairs:
        hands = g1["hands"] + g2["hands"]
        pv.append((sum(h[3] for h in g1["hh"])
                   + sum(h[3] for h in g2["hh"])) / hands)
    m = sum(pv) / len(pv)
    se = math.sqrt(sum((x - m) ** 2 for x in pv)
                   / (len(pv) - 1) / len(pv))
    wins = sum(1 for r in rows if r["w"] == 0)
    return m, se, wins, len(rows), pairs


def decomp(pairs):
    div = tot = 0
    by = {0: [0, 0.0], 1: [0, 0.0]}
    for g1, g2 in pairs:
        k = min(g1["hands"], g2["hands"])
        tot += k
        for i in range(k):
            eff = g1["hh"][i][3] + g2["hh"][i][3]
            if eff:
                div += 1
                side = g1["hh"][i][0]
                by[side][0] += 1
                by[side][1] += eff / 2
    return div, tot, by


def main():
    v2 = load("runs/gardner/gate_v2.jsonl")
    m, se, wins, n, pairs = headline(v2)
    print(f"V2 GATE: {len(pairs)} pairs, {sum(r['hands'] for r in v2)} hands")
    print(f"  Gardner-v2 - vanilla: {m:+.2f} pts/hand (SE {se:.2f}, "
          f"CI [{m-1.96*se:+.2f}, {m+1.96*se:+.2f}])")
    print(f"  game wins {wins}/{n} = {wins/n:.1%}")
    div, tot, by = decomp(pairs)
    print(f"  style-affected {div}/{tot} ({div/tot:.1%})")
    print(f"  partner-lead (A bought): {by[0][0]} hands, "
          f"{by[0][1]/max(1,by[0][0]):+.2f}/hand  "
          f"[v1 was -2.12 — mechanism bar]")
    print(f"  defender (B bought): {by[1][0]} hands, "
          f"{by[1][1]/max(1,by[1][0]):+.2f}/hand  [v1 was -0.32]")

    # pre-registered verdict
    ship = m >= -1.0
    mech = by[0][1] / max(1, by[0][0]) > -2.12
    print(f"  VERDICT: headline {'SHIP-ELIGIBLE' if ship else 'HOLD'}, "
          f"mechanism bar {'PASSED' if mech else 'FAILED'} -> "
          f"{'v2' if (ship and mech) else 'v1'} goes to the receipt duel")

    # telemetry
    tel = [json.loads(l) for p in glob.glob(
        "runs/gardner/v2_telemetry.jsonl") for l in open(p)]
    if tel:
        c = Counter(t["mech"] for t in tel)
        print(f"  telemetry ({len(tel)} partner spots): {dict(c)}")
        gaps = [t.get("gap") for t in tel
                if t.get("mech") == "tiebreak" and t.get("gap") is not None]
        if gaps:
            print(f"  tiebreak gaps: mean {sum(gaps)/len(gaps):.2f} pts, "
                  f"max {max(gaps):.2f}")

    # v1 deal-matched comparison via auction fingerprint
    try:
        v1 = load("runs/gardner/gate_tau4.jsonl")
        def fp(g):
            return tuple((h[0], h[1]) for h in g["hh"][:6])
        v1_map = {}
        for i in range(0, len(v1), 2):
            v1_map.setdefault(fp(v1[i]), []).append((v1[i], v1[i + 1]))
        matched = 0
        d_v1 = d_v2 = 0.0
        for i in range(0, len(v2), 2):
            key = fp(v2[i])
            if key in v1_map and v1_map[key]:
                a1, a2 = v1_map[key].pop()
                b1, b2 = v2[i], v2[i + 1]
                h = min(a1["hands"] + a2["hands"],
                        b1["hands"] + b2["hands"])
                d_v1 += (sum(x[3] for x in a1["hh"])
                         + sum(x[3] for x in a2["hh"])) / (
                    a1["hands"] + a2["hands"])
                d_v2 += (sum(x[3] for x in b1["hh"])
                         + sum(x[3] for x in b2["hh"])) / (
                    b1["hands"] + b2["hands"])
                matched += 1
        if matched:
            print(f"  deal-matched vs v1: {matched} pairs matched; "
                  f"v1 {d_v1/matched:+.2f} vs v2 {d_v2/matched:+.2f} "
                  f"pts/hand on the same deals")
    except FileNotFoundError:
        pass


if __name__ == "__main__":
    main()
