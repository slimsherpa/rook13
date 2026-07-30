#!/usr/bin/env python3
"""gen24 bid gym status — the 10am/10pm check-in.

    ~/torch-env/bin/python scripts/gen24_status.py [--out runs/gen24] [--last 20]

Per city: season count, current champion and its gene deltas from the
family bidder, anchor trajectory (is the population pulling away from
family / gen23?), and the champion's score-state behavior (the poker
question: does it bid differently behind vs ahead?).
"""

import argparse
import glob
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from alpharook.bidcity import CULTURES  # noqa: E402
from alpharook.bidgenes import describe  # noqa: E402


def city_report(out_dir: str, city: str, last: int) -> None:
    path = os.path.join(out_dir, city, "state.json")
    if not os.path.exists(path):
        print(f"\n== {city}: not started ==")
        return
    with open(path) as f:
        st = json.load(f)
    hist = st["history"]
    print(f"\n== {city} ({st['culture']['desc']}) — season {st['season']}, "
          f"{sum(h.get('secs', 0) for h in hist) / 3600:.1f}h played ==")
    if not hist:
        return

    win = hist[-1]["table"]
    by = {r["name"]: r for r in win}
    print(f"  latest table (W/G, avg bid, made%):")
    for r in win[:5]:
        tag = " <anchor>" if r["name"] in ("family", "gen23") else ""
        print(f"    {r['name']:<14} {r['wins']:>3}/{r['games']}  "
              f"bid {r['avg_bid']:>5}  made {r['made_pct']:.0%}  "
              f"pass {r['pass_rate']:.0%}  jump {r['jump_rate']:.0%}{tag}")
    for a in ("family", "gen23"):
        if a in by and by[a] not in win[:5]:
            pos = win.index(by[a]) + 1
            print(f"    ... {a} is P{pos} ({by[a]['wins']}/{by[a]['games']})")

    champ = st["hof"][-1]
    print(f"  champion {champ['name']}: {describe(champ['genome'])}")
    cr = by.get(champ["name"])
    if cr:
        b, a, t = cr["behind"], cr["ahead"], cr["tied"]
        print(f"  champ score-state bids: behind {b['avg_bid']} "
              f"(made {b['made_pct']:.0%}, n={b['n']}) | "
              f"ahead {a['avg_bid']} (made {a['made_pct']:.0%}, n={a['n']}) | "
              f"tied {t['avg_bid']} (made {t['made_pct']:.0%}, n={t['n']})")

    # anchor trajectory over the last N seasons: expected anchor share is
    # 50% of games — a population pulling away drives these below 0.5
    span = hist[-last:]
    for a in ("family", "gen23"):
        rates = []
        for h in span:
            r = next((x for x in h["table"] if x["name"] == a), None)
            if r and r["games"]:
                rates.append(r["wins"] / r["games"])
        if rates:
            half = len(rates) // 2 or 1
            early = sum(rates[:half]) / half
            late = sum(rates[half:]) / max(1, len(rates) - half)
            print(f"  {a} win rate, last {len(rates)} seasons: "
                  f"{early:.1%} -> {late:.1%}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="runs/gen24")
    ap.add_argument("--last", type=int, default=20)
    args = ap.parse_args()
    out = args.out if os.path.isdir(args.out) else \
        os.path.join(os.path.dirname(__file__), "..", args.out)
    print("gen24 BID GYM — status")
    for city in CULTURES:
        city_report(out, city, args.last)
    cups = sorted(glob.glob(os.path.join(out, "worldcup", "cup_*.json")))
    if cups:
        with open(cups[-1]) as f:
            cup = json.load(f)
        print(f"\n== world cup {cup['cup']} ({cup['pairs']} pairs/matchup) ==")
        for r in cup["table"]:
            print(f"    {r['name']:<20} {r['wins']:>4}/{r['games']} "
                  f"({r['wins'] / max(1, r['games']):.1%})  "
                  f"bid {r['avg_bid']}  made {r['made_pct']:.0%}")


if __name__ == "__main__":
    main()
