"""gen24 — a bid-gym city: a league of genome bidders who all play the
same cards.

Every seat in every game plays gen23 reflex (card play, go-down, trump).
The ONLY thing that varies between league members is the bidding genome
(bidgenes.py), so fitness differences are pure bidding — Rook as poker,
with the deal held constant. Games are the family format, -250/+500, which
is exactly the format that punishes bad bidding hardest (the cliff is one
set away for most of the game).

One run = one city (a process on Riley's MBP). A city plays SEASONS:
every league member meets every other on the SAME salted deck set
(duplicate decks, seats swapped — deal luck cancels across the table),
then the bottom of the table is culled and rebred from the top
(crossover + mutation). Two immortal anchors sit in every league but
never reproduce:

    family — the calibrated family bidder (default genome, score-blind)
    gen23  — gen23's own neural bidding

The anchors are the meter stick: if evolved genomes climb over both, the
population found bidding the family and the net don't know about.

Cultures (per-city evolutionary pressure):
    provo — balanced          orem — hot explorer (big mutations)
    logan — cold start (random founders: can bidding be rediscovered?)
    moab  — conservative control (small mutations around the family prior)

    ~/torch-env/bin/python -m alpharook.bidcity --city provo --seasons 1000

State is runs/gen24/<city>/state.json, saved atomically every season;
relaunching resumes. Every 10th season dumps raw per-hand auction rows for
the curiosity artifact.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import time
from itertools import combinations

import torch

from rook.cards import team_of
from .arena import model_choose
from .bidgenes import (
    GENE_NAMES, default_genome, random_genome, mutate, crossover,
    genome_bid, describe,
)
from .duel import deck_stream
from .encoder import D_BID
from .env import SelfPlayGame
from .model import load_qnet

PASS = 0
POP = 10          # evolving members per city (plus the 2 anchors)
DEFAULT_PAIRS = 3  # deck-pairs per matchup per season (x2 games, seats swapped)

CULTURES: dict[str, dict] = {
    "provo": dict(start="family", mut_p=0.35, sigma=1.0, cull=3,
                  desc="balanced"),
    "orem": dict(start="family", mut_p=0.55, sigma=2.2, cull=4,
                 desc="hot explorer"),
    "logan": dict(start="random", mut_p=0.40, sigma=1.2, cull=3,
                  desc="cold start from random genomes"),
    "moab": dict(start="family", mut_p=0.25, sigma=0.5, cull=2,
                 desc="conservative control"),
}

# Founder/child names: Rook is poker, so the bidders are poker players.
NAME_POOL = [
    "Doyle", "Slim", "Ungar", "Ivey", "Moss", "Chan", "Seidel", "Harman",
    "Duke", "Brunson", "Hellmuth", "Negreanu", "Juanda", "Ferguson",
    "Greenstein", "Mortensen", "Antonius", "Dwan", "Galfond", "Selbst",
    "Hachem", "Raymer", "Moneymaker", "Eastgate", "Cada", "Mercier",
    "Colman", "Holz", "Bonomo", "Kenney", "Deeb", "Adelstein", "Berkey",
    "Polk", "Jungleman", "Sauce", "Esfandiari", "Lederer", "Baldwin",
    "Pearson",
]


def _salt(city: str, season: int, i: int) -> int:
    h = hashlib.sha1(f"gen24:{city}:{season}:{i}".encode()).hexdigest()
    return int(h[:12], 16)


# ---------------------------------------------------------------------------
# One game: two bidding genomes, four gen23 card-players
# ---------------------------------------------------------------------------


@torch.no_grad()
def play_bid_game(net, genome0, genome1, pair_seed: int, flip: bool,
                  win_score: int = 500, lose_score: int = -250):
    """genome0/genome1: gene dict, or None for gen23's own neural bidding.
    Everything except D_BID is gen23 reflex for BOTH sides. Returns
    (winner_side, diff_for_side0, per_side_stats, hand_rows) where
    hand_rows carry the full auction + score state for telemetry."""
    genomes = [genome1, genome0] if flip else [genome0, genome1]  # by team
    env = SelfPlayGame(seed=pair_seed, deck_fn=deck_stream(pair_seed),
                       dealer=pair_seed % 4,
                       win_score=win_score, lose_score=lose_score)
    side0_team = 1 if flip else 0
    hand_rows: list[dict] = []
    cur: dict | None = None

    while not env.done:
        seat, dtype, cands = env.decision()
        g = env.g
        if dtype == D_BID:
            if cur is None or cur["hand"] != g.hand_number:
                if cur is not None:
                    hand_rows.append(cur)
                cur = dict(hand=g.hand_number,
                           scores=[int(g.scores[side0_team]),
                                   int(g.scores[1 - side0_team])],
                           bids=[])
            gm = genomes[team_of(seat)]
            if gm is not None:
                action = genome_bid(g, seat, gm)
            else:
                action = model_choose(net, "cpu", env, seat, dtype, cands)
            side = 0 if team_of(seat) == side0_team else 1
            cur["bids"].append([side, int(action),
                               int(g.min_next_bid() or 0)])
        else:
            action = model_choose(net, "cpu", env, seat, dtype, cands)
        env.apply(action)
    if cur is not None:
        hand_rows.append(cur)

    g = env.g
    diff0 = g.scores[side0_team] - g.scores[1 - side0_team]
    winner_side = 0 if g.winner == side0_team else 1

    stats = {0: dict(contracts=0, made=0, bid_sum=0),
             1: dict(contracts=0, made=0, bid_sum=0)}
    hist = {h[0]: h for h in g.hand_history}
    for row in hand_rows:
        h = hist.get(row["hand"])
        if h is None:
            continue
        side = 0 if team_of(h[1]) == side0_team else 1
        row["bidder"] = side
        row["bid"] = int(h[2])
        row["set"] = bool(h[6])
        stats[side]["contracts"] += 1
        stats[side]["made"] += 0 if h[6] else 1
        stats[side]["bid_sum"] += int(h[2])
    return winner_side, int(diff0), stats, hand_rows


# ---------------------------------------------------------------------------
# Season bookkeeping
# ---------------------------------------------------------------------------


def _blank_acc() -> dict:
    return dict(wins=0, games=0, diff=0, contracts=0, made=0, bid_sum=0,
                bid_turns=0, passes=0, jumps=0,
                behind=dict(n=0, made=0, bid_sum=0),
                ahead=dict(n=0, made=0, bid_sum=0),
                tied=dict(n=0, made=0, bid_sum=0))


def _absorb(acc: dict, side: int, won: bool, diff0: int, stats: dict,
            hand_rows: list[dict]) -> None:
    acc["wins"] += 1 if won else 0
    acc["games"] += 1
    acc["diff"] += diff0 if side == 0 else -diff0
    for k in ("contracts", "made", "bid_sum"):
        acc[k] += stats[side][k]
    for row in hand_rows:
        my, opp = (row["scores"] if side == 0 else row["scores"][::-1])
        for s, action, floor in row["bids"]:
            if s != side:
                continue
            acc["bid_turns"] += 1
            if action == PASS:
                acc["passes"] += 1
            elif floor and action > floor:
                acc["jumps"] += 1
        if row.get("bidder") == side:
            bucket = ("behind" if my < opp else
                      "ahead" if my > opp else "tied")
            acc[bucket]["n"] += 1
            acc[bucket]["made"] += 0 if row["set"] else 1
            acc[bucket]["bid_sum"] += row["bid"]


def _table_row(name: str, acc: dict) -> dict:
    c = max(1, acc["contracts"])
    row = dict(name=name, wins=acc["wins"], games=acc["games"],
               diff=acc["diff"], contracts=acc["contracts"],
               made_pct=round(acc["made"] / c, 3),
               avg_bid=round(acc["bid_sum"] / c, 1),
               pass_rate=round(acc["passes"] / max(1, acc["bid_turns"]), 3),
               jump_rate=round(acc["jumps"] / max(1, acc["bid_turns"]), 3))
    for b in ("behind", "ahead", "tied"):
        n = max(1, acc[b]["n"])
        row[b] = dict(n=acc[b]["n"], made_pct=round(acc[b]["made"] / n, 3),
                      avg_bid=round(acc[b]["bid_sum"] / n, 1))
    return row


# ---------------------------------------------------------------------------
# The city
# ---------------------------------------------------------------------------


class City:
    def __init__(self, city: str, out_dir: str, net_path: str,
                 pairs: int = DEFAULT_PAIRS):
        assert city in CULTURES, f"unknown city {city}"
        self.city = city
        self.culture = CULTURES[city]
        self.dir = os.path.join(out_dir, city)
        os.makedirs(self.dir, exist_ok=True)
        self.state_path = os.path.join(self.dir, "state.json")
        self.pairs = pairs
        self.net = load_qnet(net_path)
        self.rng = random.Random(_salt(city, 0, 0))
        self.state = self._load_or_found()

    def _load_or_found(self) -> dict:
        if os.path.exists(self.state_path):
            with open(self.state_path) as f:
                return json.load(f)
        rng = random.Random(_salt(self.city, 0, 1))
        names = list(NAME_POOL)
        rng.shuffle(names)
        pop = []
        for i in range(POP):
            if self.culture["start"] == "random":
                genome = random_genome(rng)
            elif i == 0:
                genome = default_genome()  # one pristine family founder
            else:
                genome = mutate(default_genome(), rng, p=1.0,
                                sigma_scale=self.culture["sigma"])
            pop.append(dict(name=names[i], genome=genome, born=0,
                            parents=[]))
        return dict(city=self.city, culture=self.culture, season=0,
                    name_counter=POP, name_order=names, pop=pop,
                    hof=[], history=[])

    def _save(self) -> None:
        tmp = self.state_path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.state, f)
        os.replace(tmp, self.state_path)

    def _next_name(self) -> str:
        st = self.state
        k = st["name_counter"]
        st["name_counter"] = k + 1
        base = st["name_order"][k % len(st["name_order"])]
        gen = k // len(st["name_order"])
        return base if gen == 0 else f"{base}{gen + 1}"

    def run_season(self) -> dict:
        st = self.state
        season = st["season"] + 1
        t0 = time.time()
        roster: list[tuple[str, dict | None]] = (
            [("family", default_genome()), ("gen23", None)]
            + [(m["name"], m["genome"]) for m in st["pop"]])
        accs = {name: _blank_acc() for name, _ in roster}
        seeds = [_salt(self.city, season, i) for i in range(self.pairs)]
        dump_rows = [] if season % 10 == 0 else None

        for i, j in combinations(range(len(roster)), 2):
            (ni, gi), (nj, gj) = roster[i], roster[j]
            for s in seeds:
                for flip in (False, True):
                    w, d0, stats, hands = play_bid_game(
                        self.net, gi, gj, s, flip)
                    _absorb(accs[ni], 0, w == 0, d0, stats, hands)
                    _absorb(accs[nj], 1, w == 1, d0, stats, hands)
                    if dump_rows is not None:
                        dump_rows.append(dict(season=season, seed=s,
                                              flip=int(flip), a=ni, b=nj,
                                              w=w, hands=hands))

        table = sorted((_table_row(n, a) for n, a in accs.items()),
                       key=lambda r: (-r["wins"], -r["diff"]))
        by_name = {r["name"]: r for r in table}

        # --- selection: evolvers only; anchors are immortal furniture -----
        evolvers = sorted(st["pop"],
                          key=lambda m: (-by_name[m["name"]]["wins"],
                                         -by_name[m["name"]]["diff"]))
        champ = evolvers[0]
        cull = self.culture["cull"]
        survivors, culled = evolvers[:-cull], evolvers[-cull:]
        rng = random.Random(_salt(self.city, season, 999))
        parents_pool = survivors[:max(2, len(survivors) // 2 + 1)]
        weights = list(range(len(parents_pool), 0, -1))
        children = []
        for _ in culled:
            p1, p2 = rng.choices(parents_pool, weights=weights, k=2)
            tries = 0
            while p2 is p1 and tries < 5:
                p2 = rng.choices(parents_pool, weights=weights, k=1)[0]
                tries += 1
            genome = mutate(crossover(p1["genome"], p2["genome"], rng), rng,
                            p=self.culture["mut_p"],
                            sigma_scale=self.culture["sigma"])
            children.append(dict(name=self._next_name(), genome=genome,
                                 born=season,
                                 parents=[p1["name"], p2["name"]]))
        st["pop"] = survivors + children
        st["season"] = season
        st["hof"].append(dict(season=season, name=champ["name"],
                              genome=champ["genome"],
                              record={k: by_name[champ["name"]][k]
                                      for k in ("wins", "games", "diff",
                                                "avg_bid", "made_pct")}))
        st["history"].append(dict(season=season, table=table,
                                  secs=round(time.time() - t0, 1)))
        if dump_rows is not None:
            path = os.path.join(self.dir, f"hands_s{season:04d}.jsonl")
            with open(path, "w") as f:
                for r in dump_rows:
                    f.write(json.dumps(r) + "\n")
        self._save()

        cr = by_name[champ["name"]]
        fam, g23 = by_name["family"], by_name["gen23"]
        games = max(1, cr["games"])
        print(f"[{self.city} s{season}] champ {champ['name']} "
              f"{cr['wins']}/{cr['games']} ({cr['wins'] / games:.0%}) "
              f"avg bid {cr['avg_bid']} made {cr['made_pct']:.0%} | "
              f"family {fam['wins']}/{fam['games']} | "
              f"gen23 {g23['wins']}/{g23['games']} | "
              f"{time.time() - t0:.0f}s", flush=True)
        print(f"  champ genes: {describe(champ['genome'])}", flush=True)
        return by_name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", required=True, choices=list(CULTURES))
    ap.add_argument("--seasons", type=int, default=1000)
    ap.add_argument("--pairs", type=int, default=DEFAULT_PAIRS,
                    help="deck-pairs per matchup per season (x2 games)")
    ap.add_argument("--net", default="models/gen23-cand1.pt")
    ap.add_argument("--out", default="runs/gen24")
    args = ap.parse_args()

    torch.set_num_threads(1)
    city = City(args.city, args.out, args.net, pairs=args.pairs)
    print(f"gen24 bid gym — {args.city} ({city.culture['desc']}), "
          f"resuming at season {city.state['season']}, "
          f"pop {len(city.state['pop'])} + 2 anchors, "
          f"{args.pairs} pairs/matchup", flush=True)
    for _ in range(args.seasons):
        city.run_season()


if __name__ == "__main__":
    main()
