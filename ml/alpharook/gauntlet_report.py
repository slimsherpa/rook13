"""Aggregate gen21 gauntlet dumps into Riley's stat table.

Reads the per-game JSONL files written by duel.py --dump (side A is always
gen21-cand1) and prints one row per matchup:

  win% · avg scorecard · W-L-T · avg hands · A avg bid · took-it share ·
  took-and-made% · set% (own contracts set) · opp made% · avg diff

Ties are structurally impossible (a Rook game ends when a team crosses the
win or elimination line), so T is always 0 — the column stays for honesty.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ORDER = ["sprint-gen13", "sprint-gen16", "sprint-gen19", "sprint-self",
         "marathon-gen13", "marathon-gen16", "marathon-gen19",
         "marathon-self"]
LABELS = {"gen13": "Puma (gen13)", "gen16": "Cougar (gen16 prod)",
          "gen19": "Cosmo (gen19 prod)", "self": "itself"}


def row(path: Path):
    recs = [json.loads(l) for l in open(path) if l.strip()]
    n = len(recs)
    if not n:
        return None
    w = sum(1 for r in recs if r["w"] == 0)
    losses = n - w
    a_sc = sum(r["a"] for r in recs) / n
    b_sc = sum(r["b"] for r in recs) / n
    hands = sum(r["hands"] for r in recs) / n
    a_con = sum(r["a_contracts"] for r in recs)
    b_con = sum(r["b_contracts"] for r in recs)
    a_made = sum(r["a_made"] for r in recs)
    b_made = sum(r["b_made"] for r in recs)
    a_bids = sum(r["a_bids"] for r in recs)
    wr = w / n
    se = math.sqrt(max(wr * (1 - wr), 1e-9) / n)
    return dict(games=n, wr=wr, ci=1.96 * se, a_sc=a_sc, b_sc=b_sc,
                wins=w, losses=losses, hands=hands,
                a_bid=a_bids / max(a_con, 1),
                took=a_con / max(a_con + b_con, 1),
                a_made=a_made / max(a_con, 1),
                a_set=1 - a_made / max(a_con, 1),
                b_made=b_made / max(b_con, 1),
                diff=(sum(r["a"] - r["b"] for r in recs) / n))


def main() -> None:
    base = Path(sys.argv[1] if len(sys.argv) > 1 else "runs/gauntlet")
    print(f"{'matchup':<28} {'win%':>10} {'avg scorecard':>18} "
          f"{'W-L-T':>13} {'hands':>6} {'bid':>6} {'took':>6} "
          f"{'made%':>6} {'set%':>6} {'opp made%':>9} {'avg diff':>9}")
    for name in ORDER:
        p = base / f"{name}.jsonl"
        if not p.exists():
            print(f"{name:<28} (pending)")
            continue
        fmt, opp = name.split("-")
        r = row(p)
        if r is None:
            print(f"{name:<28} (empty)")
            continue
        label = f"{fmt} vs {LABELS[opp]}"
        print(f"{label:<28} {r['wr']:.1%} ±{r['ci']:.1%} "
              f"{r['a_sc']:>7.0f} to {r['b_sc']:<7.0f} "
              f"{r['wins']:>5}-{r['losses']}-0 {r['hands']:>6.1f} "
              f"{r['a_bid']:>6.1f} {r['took']:>6.1%} {r['a_made']:>6.1%} "
              f"{r['a_set']:>6.1%} {r['b_made']:>9.1%} {r['diff']:>+9.1f}")


if __name__ == "__main__":
    main()
