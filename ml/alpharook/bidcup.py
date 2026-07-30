"""gen24 world cup: the four city champions meet, plus the two anchors.

Cities evolve in isolation (different cultures, different decks). The cup
is the cross-check: fresh salted decks nobody trained on, more pairs per
matchup than any league night, full round-robin. Ledger law 2 applies —
in-city standings are weather, the cup is climate.

    ~/torch-env/bin/python -m alpharook.bidcup --pairs 40

Writes runs/gen24/worldcup/cup_NNN.json (genomes + full head-to-head).
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import time
from itertools import combinations

import torch

from .bidcity import CULTURES, play_bid_game, _blank_acc, _absorb, _table_row
from .bidgenes import default_genome, describe
from .duel import deck_stream  # noqa: F401  (re-exported for repl use)
from .model import load_qnet


def load_champion(out_dir: str, city: str):
    path = os.path.join(out_dir, city, "state.json")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        st = json.load(f)
    if not st["hof"]:
        return None
    champ = st["hof"][-1]
    return dict(name=f"{city}·{champ['name']}", genome=champ["genome"],
                season=champ["season"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", type=int, default=40)
    ap.add_argument("--net", default="models/gen23-cand1.pt")
    ap.add_argument("--out", default="runs/gen24")
    ap.add_argument("--seed", type=int, default=None,
                    help="deck salt; default = cup number")
    args = ap.parse_args()

    torch.set_num_threads(1)
    cup_dir = os.path.join(args.out, "worldcup")
    os.makedirs(cup_dir, exist_ok=True)
    cup_n = len(glob.glob(os.path.join(cup_dir, "cup_*.json"))) + 1
    salt = args.seed if args.seed is not None else cup_n

    roster = [("family", default_genome()), ("gen23", None)]
    entries = {}
    for city in CULTURES:
        champ = load_champion(args.out, city)
        if champ:
            roster.append((champ["name"], champ["genome"]))
            entries[champ["name"]] = champ
    assert len(roster) > 2, "no city champions found — run bidcity first"

    net = load_qnet(args.net)
    accs = {name: _blank_acc() for name, _ in roster}
    h2h = {name: {} for name, _ in roster}
    seeds = [0xC0FFEE + salt * 7_919_003 + i * 104_729
             for i in range(args.pairs)]
    t0 = time.time()

    for i, j in combinations(range(len(roster)), 2):
        (ni, gi), (nj, gj) = roster[i], roster[j]
        wi = 0
        for s in seeds:
            for flip in (False, True):
                w, d0, stats, hands = play_bid_game(net, gi, gj, s, flip)
                _absorb(accs[ni], 0, w == 0, d0, stats, hands)
                _absorb(accs[nj], 1, w == 1, d0, stats, hands)
                wi += 1 if w == 0 else 0
        h2h[ni][nj] = wi
        h2h[nj][ni] = 2 * args.pairs - wi
        print(f"  {ni} vs {nj}: {wi}-{2 * args.pairs - wi}", flush=True)

    table = sorted((_table_row(n, a) for n, a in accs.items()),
                   key=lambda r: (-r["wins"], -r["diff"]))
    games = 2 * args.pairs * (len(roster) - 1)
    print(f"\n=== WORLD CUP {cup_n} — {args.pairs} pairs/matchup, "
          f"{games} games each, {time.time() - t0:.0f}s ===")
    for r in table:
        print(f"  {r['name']:<20} {r['wins']:>4}/{r['games']} "
              f"({r['wins'] / max(1, r['games']):.1%})  "
              f"avg bid {r['avg_bid']:>5}  made {r['made_pct']:.0%}  "
              f"pass {r['pass_rate']:.0%}  jump {r['jump_rate']:.0%}")
    for name, e in entries.items():
        print(f"  {name}: {describe(e['genome'])}")

    out = dict(cup=cup_n, pairs=args.pairs, salt=salt, table=table, h2h=h2h,
               champions=entries, ts=time.time())
    path = os.path.join(cup_dir, f"cup_{cup_n:03d}.json")
    with open(path, "w") as f:
        json.dump(out, f)
    print(f"  -> {path}")


if __name__ == "__main__":
    main()
