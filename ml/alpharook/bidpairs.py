"""gen24 Layer 3 — the partnership league: locked pairs, shared language,
gen23 strength underneath.

Riley's design: Cada is paired with Jungleman FOR LIFE. They sit opposite
chairs, evolve together as one organism with two personalities, and craft
their own bidding culture against other locked pairs. Every few seasons
the whole league runs the GAUNTLET against the house team — locked
gen23 & gen23 — and the pair that beats the house most is the champion.

The key ML decision (learned the hard way from the gene cities): a
member's bid policy is NOT a formula replacing gen23 — it is gen23's own
Q-values plus a small vector of interpretable logit-unit modulations.
All-zero genes bid EXACTLY like the house. Evolution therefore starts at
parity and explores deviations: aggression, score-geometry courage,
and — the experiment — conventions:

  * an OPENING LADDER (map my hand strength to a statement level), and
  * a PARTNER-READING gain (how much partner's opening level moves me).

Both partners share the pair's fate but hold separate genomes, so one can
drift risky while the other learns to read them — asymmetric personality,
symmetric destiny. Conventions only pay if bid-as-message beats
bid-as-price; the league is the test, and the genes print the language.

Methodology fixes over the retired gene cities: fitness is mirrored-deck
POINT DIFFERENTIAL (not game wins), smoothed by an EMA across seasons
before anyone is culled; fresh salted decks every season; no anchors
inside the league — the house is only ever the exam.

    ~/torch-env/bin/python -m alpharook.bidpairs --seasons 100000
    ~/torch-env/bin/python -m alpharook.bidpairs --gauntlet-only
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import time
from itertools import combinations

import numpy as np
import torch

from rook.cards import PASS, SEATS, VALID_BIDS, team_of, partner_of
from rook.bots import estimate_tricks
from .arena import model_choose
from .duel import deck_stream
from .encoder import D_BID, encode_action, encode_state_for
from .env import SelfPlayGame
from .model import load_qnet
from rook.observation import observe
from .winprob import WinProb  # noqa: F401  (re-export for analysis)

POP_PAIRS = 12
PAIRS_PER_MATCH = 6      # deck-pairs per league matchup (x2 games each)
CULL = 2
EMA = 0.5                # fitness smoothing across seasons
GAUNTLET_EVERY = 8
GAUNTLET_DECKS = 30      # deck-pairs vs the house per pair

# Genes are LOGIT-UNIT bonuses added to gen23's Q-values per candidate.
# (gen23's head spans roughly -111..+52; a 1-2 unit nudge flips only
# near-ties, which is exactly where style lives.)  All defaults 0.
PAIR_GENES: dict[str, tuple[float, float, float]] = {
    # (lo, hi, sigma) — default is always 0.0
    "pass_bias":       (-4.0, 4.0, 0.4),
    "jump_extra":      (-3.0, 3.0, 0.3),   # raises above the floor
    "war_bias":        (-3.0, 3.0, 0.3),   # enemy holds the high bid
    "partner_high":    (-4.0, 4.0, 0.4),   # raising my own partner
    "behind_raise":    (-3.0, 3.0, 0.3),   # scaled by tanh(deficit/200)
    "cliff_pass":      (-1.0, 5.0, 0.4),   # a set here ends the game
    "close_raise":     (-3.0, 3.0, 0.3),   # we are >= 350
    "opp_close_raise": (-3.0, 3.0, 0.3),   # they are >= 350
    # conventions
    "open_gain":       (0.0, 4.0, 0.35),   # pull toward my ladder level
    "open_lo":         (0.5, 3.5, 0.25),   # tricks -> open low zone
    "open_hi":         (2.5, 6.0, 0.25),   # tricks -> open 100 zone
    "read_gain":       (-2.0, 5.0, 0.4),   # partner's opening level moves me
    "trust_pass":      (-3.0, 3.0, 0.3),   # partner passed
}
GENE_NAMES = list(PAIR_GENES)

NAME_POOL = [
    "Doyle", "Slim", "Ungar", "Ivey", "Moss", "Chan", "Seidel", "Harman",
    "Duke", "Brunson", "Hellmuth", "Negreanu", "Juanda", "Ferguson",
    "Greenstein", "Mortensen", "Antonius", "Dwan", "Galfond", "Selbst",
    "Hachem", "Raymer", "Moneymaker", "Eastgate", "Cada", "Mercier",
    "Colman", "Holz", "Bonomo", "Kenney", "Deeb", "Adelstein", "Berkey",
    "Polk", "Jungleman", "Sauce", "Esfandiari", "Lederer", "Baldwin",
    "Pearson",
]


def zero_genome() -> dict[str, float]:
    return {k: 0.0 for k in PAIR_GENES}


def mutate(genome: dict[str, float], rng: random.Random,
           p: float = 0.4, scale: float = 1.0) -> dict[str, float]:
    child = dict(genome)
    for k, (lo, hi, sigma) in PAIR_GENES.items():
        if rng.random() < p:
            child[k] = min(hi, max(lo, child[k] + rng.gauss(0, sigma * scale)))
    return child


def crossover(a: dict[str, float], b: dict[str, float],
              rng: random.Random) -> dict[str, float]:
    return {k: (a if rng.random() < 0.5 else b)[k] for k in PAIR_GENES}


def describe(genome: dict[str, float]) -> str:
    out = []
    for k, (_lo, _hi, sigma) in PAIR_GENES.items():
        if abs(genome[k]) >= 0.75 * sigma:
            out.append(f"{k} {genome[k]:+.2f}")
    return ", ".join(out) if out else "= house (gen23)"


def _salt(tag: str, season: int, i: int) -> int:
    return int(hashlib.sha1(f"gen24p:{tag}:{season}:{i}".encode())
               .hexdigest()[:12], 16)


# ---------------------------------------------------------------------------
# The modulated bidder
# ---------------------------------------------------------------------------


def q_values(net, env, seat: int, cands: list[int]) -> np.ndarray:
    s = encode_state_for(net, observe(env.g, seat), env.picks, D_BID, env.g,
                         env.trump_intent)
    S = torch.from_numpy(np.stack([s] * len(cands)))
    A = torch.from_numpy(np.stack([encode_action(D_BID, a) for a in cands]))
    return net(S, A).numpy().reshape(-1)


def _ladder_level(genome: dict[str, float], tricks: float) -> float:
    lo, hi = genome["open_lo"], max(genome["open_lo"] + 0.5, genome["open_hi"])
    frac = min(1.0, max(0.0, (tricks - lo) / (hi - lo)))
    return 65.0 + frac * 35.0        # 65 .. 100 statement zone


def modulated_bid(net, env, seat: int, cands: list[int],
                  genome: dict[str, float]) -> int:
    g = env.g
    if len(cands) == 1:
        return cands[0]
    q = q_values(net, env, seat, cands)

    me = team_of(seat)
    my_s, opp_s = g.scores[me], g.scores[1 - me]
    floor = g.min_next_bid()
    partner = partner_of(seat)
    partner_first = next((b for s, b in g.bid_history
                          if s == partner and b != PASS), None)
    partner_passed = g.bids[partner] == PASS and partner_first is None
    partner_has_high = (g.high_bid is not None
                        and g.bids[partner] == g.high_bid)
    enemy_has_high = (g.high_bid is not None and not partner_has_high
                      and g.bids[seat] != g.high_bid)
    i_am_opening = (g.bids[seat] is None and partner_first is None)
    behind = math.tanh((opp_s - my_s) / 200.0)
    ladder = (_ladder_level(genome, estimate_tricks(g.hands[seat]))
              if i_am_opening else None)

    raise_shift = 0.0
    if partner_first is not None:
        # partner's opening level, normalized -1 (65) .. +1 (100+)
        lvl = min(1.0, max(-1.0, ((partner_first - 65.0) / 17.5) - 1.0))
        raise_shift += genome["read_gain"] * lvl
    raise_shift += genome["behind_raise"] * behind
    if my_s >= 350:
        raise_shift += genome["close_raise"]
    if opp_s >= 350:
        raise_shift += genome["opp_close_raise"]

    for i, c in enumerate(cands):
        if c == PASS:
            q[i] += genome["pass_bias"]
            if partner_passed:
                q[i] += genome["trust_pass"]
            continue
        q[i] += raise_shift
        if floor is not None and c > floor:
            q[i] += genome["jump_extra"]
        if enemy_has_high:
            q[i] += genome["war_bias"]
        if partner_has_high:
            q[i] += genome["partner_high"]
        if my_s - c <= g.lose_score:
            q[i] -= genome["cliff_pass"]
        if ladder is not None:
            q[i] += genome["open_gain"] * (1.0 - abs(c - ladder) / 17.5)
    return cands[int(np.argmax(q))]


# ---------------------------------------------------------------------------
# One game: pair vs pair (or house = None genomes)
# ---------------------------------------------------------------------------


@torch.no_grad()
def play_pair_game(net, pairA, pairB, pair_seed: int, flip: bool,
                   win_score: int = 500, lose_score: int = -250,
                   telemetry: list | None = None):
    """pairX = (genomeFirstChair, genomeSecondChair) or None for the house.
    First chair sits the lower seat of the team. Returns
    (winner_side, diff_for_A, per-side stats)."""
    sides = [pairB, pairA] if flip else [pairA, pairB]   # by team
    env = SelfPlayGame(seed=pair_seed, deck_fn=deck_stream(pair_seed),
                       dealer=pair_seed % 4,
                       win_score=win_score, lose_score=lose_score)
    a_team = 1 if flip else 0
    while not env.done:
        seat, dtype, cands = env.decision()
        g = env.g
        if dtype == D_BID:
            side = sides[team_of(seat)]
            if side is not None:
                chair = 0 if seat < 2 else 1
                genome = side[chair]
                action = modulated_bid(net, env, seat, cands, genome)
            else:
                action = model_choose(net, "cpu", env, seat, dtype, cands)
            if telemetry is not None and side is not None and \
                    g.bids[seat] is None and action != PASS and \
                    next((b for s2, b in g.bid_history
                          if s2 == partner_of(seat) and b != PASS), None) is None:
                side_idx = 0 if team_of(seat) == a_team else 1
                telemetry.append((side_idx, chair,
                                  round(estimate_tricks(g.hands[seat]), 2),
                                  int(action)))   # opening statements
        else:
            action = model_choose(net, "cpu", env, seat, dtype, cands)
        env.apply(action)
    g = env.g
    diff = g.scores[a_team] - g.scores[1 - a_team]
    winner = 0 if g.winner == a_team else 1
    stats = {0: dict(contracts=0, made=0, bid_sum=0),
             1: dict(contracts=0, made=0, bid_sum=0)}
    for h in g.hand_history:
        i = 0 if team_of(h[1]) == a_team else 1
        stats[i]["contracts"] += 1
        stats[i]["made"] += 0 if h[6] else 1
        stats[i]["bid_sum"] += h[2]
    return winner, int(diff), stats


# ---------------------------------------------------------------------------
# Multiprocess league plumbing
# ---------------------------------------------------------------------------

_W: dict = {}


def _worker_init(net_path: str):
    torch.set_num_threads(1)
    _W["net"] = load_qnet(net_path)


def _worker_match(job):
    """job = (i, j, pairA, pairB, seeds) -> aggregated matchup result."""
    i, j, pa, pb, seeds = job
    net = _W["net"]
    wins = diff = 0
    stats = {0: dict(contracts=0, made=0, bid_sum=0),
             1: dict(contracts=0, made=0, bid_sum=0)}
    tel: list = []
    for s in seeds:
        for flip in (False, True):
            w, d, st = play_pair_game(net, pa, pb, s, flip, telemetry=tel)
            wins += 1 if w == 0 else 0
            diff += d
            for k in (0, 1):
                for f in stats[k]:
                    stats[k][f] += st[k][f]
    tel_i = [(ch, t, b) for s2, ch, t, b in tel if s2 == 0]
    tel_j = [(ch, t, b) for s2, ch, t, b in tel if s2 == 1]
    return i, j, wins, diff, stats, tel_i, tel_j


def _worker_gauntlet(job):
    """job = (idx, pair, seeds) -> pair vs house."""
    idx, pair, seeds = job
    net = _W["net"]
    wins = diff = games = 0
    for s in seeds:
        for flip in (False, True):
            w, d, _ = play_pair_game(net, pair, None, s, flip)
            wins += 1 if w == 0 else 0
            diff += d
            games += 1
    return idx, wins, games, diff


# ---------------------------------------------------------------------------
# The league
# ---------------------------------------------------------------------------


class PairsLeague:
    def __init__(self, out_dir: str, net_path: str, workers: int):
        self.dir = out_dir
        os.makedirs(self.dir, exist_ok=True)
        self.state_path = os.path.join(self.dir, "state.json")
        self.net_path = net_path
        self.workers = workers
        self.state = self._load_or_found()
        import multiprocessing as mp
        ctx = mp.get_context("spawn")
        self.pool = ctx.Pool(workers, initializer=_worker_init,
                             initargs=(net_path,))

    def _load_or_found(self) -> dict:
        if os.path.exists(self.state_path):
            with open(self.state_path) as f:
                return json.load(f)
        rng = random.Random(0xA1FA)
        names = list(NAME_POOL)
        rng.shuffle(names)
        pairs = []
        for i in range(POP_PAIRS):
            a, b = names[2 * i], names[2 * i + 1]
            # founders: one pristine house pair, the rest lightly nudged
            ga = zero_genome() if i == 0 else mutate(zero_genome(), rng, p=1.0)
            gb = zero_genome() if i == 0 else mutate(zero_genome(), rng, p=1.0)
            pairs.append(dict(name=f"{a}&{b}", first=a, second=b,
                              gA=ga, gB=gb, born=0, ema=None, age=0))
        return dict(season=0, pairs=pairs, name_counter=2 * POP_PAIRS,
                    name_order=names, history=[], gauntlets=[], hof=[])

    def _save(self):
        tmp = self.state_path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.state, f)
        os.replace(tmp, self.state_path)

    def _next_names(self):
        st = self.state
        out = []
        for _ in range(2):
            k = st["name_counter"]
            st["name_counter"] += 1
            base = st["name_order"][k % len(st["name_order"])]
            gen = k // len(st["name_order"])
            out.append(base if gen == 0 else f"{base}{gen + 1}")
        return out

    def run_season(self):
        st = self.state
        season = st["season"] + 1
        t0 = time.time()
        pairs = st["pairs"]
        seeds = [_salt("league", season, i) for i in range(PAIRS_PER_MATCH)]
        jobs = [(i, j, (pairs[i]["gA"], pairs[i]["gB"]),
                 (pairs[j]["gA"], pairs[j]["gB"]), seeds)
                for i, j in combinations(range(len(pairs)), 2)]
        acc = [dict(wins=0, games=0, diff=0, contracts=0, made=0, bid_sum=0)
               for _ in pairs]
        tel_by_pair: dict[int, list] = {i: [] for i in range(len(pairs))}
        for i, j, wins, diff, stats, tel_i, tel_j in \
                self.pool.imap_unordered(_worker_match, jobs):
            n = 2 * PAIRS_PER_MATCH
            acc[i]["wins"] += wins
            acc[i]["games"] += n
            acc[i]["diff"] += diff
            acc[j]["wins"] += n - wins
            acc[j]["games"] += n
            acc[j]["diff"] -= diff
            for side, idx in ((0, i), (1, j)):
                for f in ("contracts", "made", "bid_sum"):
                    acc[idx][f] += stats[side][f]
            tel_by_pair[i].extend(tel_i)
            tel_by_pair[j].extend(tel_j)

        # fitness: per-game point differential, EMA-smoothed
        for p, a in zip(pairs, acc):
            fit = a["diff"] / max(1, a["games"])
            p["ema"] = fit if p["ema"] is None else \
                EMA * p["ema"] + (1 - EMA) * fit
            p["age"] += 1
            p["last"] = dict(
                wins=a["wins"], games=a["games"], diff=a["diff"],
                made_pct=round(a["made"] / max(1, a["contracts"]), 3),
                avg_bid=round(a["bid_sum"] / max(1, a["contracts"]), 1))

        ranked = sorted(pairs, key=lambda p: -p["ema"])
        # convention snapshot: opening level by tricks bucket, per chair
        conv = {}
        for i, p in enumerate(pairs):
            rowsA = [(t, b) for ch, t, b in tel_by_pair[i] if ch == 0]
            rowsB = [(t, b) for ch, t, b in tel_by_pair[i] if ch == 1]
            conv[p["name"]] = {
                "A": _ladder_summary(rowsA), "B": _ladder_summary(rowsB)}

        # cull & breed (children start with parents' mean EMA as prior)
        rng = random.Random(_salt("breed", season, 0))
        survivors, culled = ranked[:-CULL], ranked[-CULL:]
        parents_pool = survivors[:max(2, len(survivors) // 2)]
        children = []
        for _ in culled:
            m, f = rng.sample(parents_pool, 2)
            na, nb = self._next_names()
            children.append(dict(
                name=f"{na}&{nb}", first=na, second=nb,
                gA=mutate(crossover(m["gA"], f["gA"], rng), rng),
                gB=mutate(crossover(m["gB"], f["gB"], rng), rng),
                born=season, age=0,
                ema=(m["ema"] + f["ema"]) / 2 * 0.8,
                parents=[m["name"], f["name"]]))
        st["pairs"] = survivors + children
        st["season"] = season
        champ = ranked[0]
        st["history"].append(dict(
            season=season, secs=round(time.time() - t0, 1),
            table=[dict(name=p["name"], ema=round(p["ema"], 2),
                        **p["last"]) for p in ranked],
            conventions=conv))
        if len(st["history"]) > 400:
            st["history"] = st["history"][-400:]

        if season % GAUNTLET_EVERY == 0:
            self.run_gauntlet(season)
        self._save()
        print(f"[pairs s{season}] top {champ['name']} ema {champ['ema']:+.1f} "
              f"({champ['last']['wins']}/{champ['last']['games']}, "
              f"bid {champ['last']['avg_bid']}, made "
              f"{champ['last']['made_pct']:.0%}) | {time.time() - t0:.0f}s")
        print(f"  A: {describe(champ['gA'])}")
        print(f"  B: {describe(champ['gB'])}")

    def run_gauntlet(self, season: int):
        st = self.state
        t0 = time.time()
        seeds = [_salt("gauntlet", season, i) for i in range(GAUNTLET_DECKS)]
        jobs = [(i, (p["gA"], p["gB"]), seeds)
                for i, p in enumerate(st["pairs"])]
        rows = []
        for idx, wins, games, diff in \
                self.pool.imap_unordered(_worker_gauntlet, jobs):
            p = st["pairs"][idx]
            rows.append(dict(name=p["name"], wins=wins, games=games,
                             diff=diff, rate=round(wins / games, 3)))
        rows.sort(key=lambda r: (-r["wins"], -r["diff"]))
        st["gauntlets"].append(dict(season=season, decks=GAUNTLET_DECKS,
                                    rows=rows,
                                    secs=round(time.time() - t0, 1)))
        best = rows[0]
        bp = next(p for p in st["pairs"] if p["name"] == best["name"])
        st["hof"].append(dict(season=season, name=best["name"],
                              rate=best["rate"], gA=bp["gA"], gB=bp["gB"]))
        print(f"  GAUNTLET s{season}: best vs house = {best['name']} "
              f"{best['wins']}/{best['games']} ({best['rate']:.0%}); "
              f"league median {rows[len(rows) // 2]['rate']:.0%}")


def _ladder_summary(rows):
    """mean opening level per tricks bucket — the printed convention."""
    buckets = [(0, 1.5), (1.5, 2.5), (2.5, 4.0), (4.0, 99)]
    out = []
    for lo, hi in buckets:
        lv = [b for t, b in rows if lo <= t < hi]
        out.append(round(sum(lv) / len(lv), 1) if lv else None)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", type=int, default=100000)
    ap.add_argument("--net", default="models/gen23-cand1.pt")
    ap.add_argument("--out", default="runs/gen24/pairs")
    ap.add_argument("--workers", type=int, default=5)
    ap.add_argument("--gauntlet-only", action="store_true")
    args = ap.parse_args()
    league = PairsLeague(args.out, args.net, args.workers)
    print(f"gen24 pairs league — season {league.state['season']}, "
          f"{len(league.state['pairs'])} locked pairs, "
          f"{PAIRS_PER_MATCH} deck-pairs/matchup, gauntlet every "
          f"{GAUNTLET_EVERY}", flush=True)
    if args.gauntlet_only:
        league.run_gauntlet(league.state["season"])
        league._save()
        return
    for _ in range(args.seasons):
        league.run_season()


if __name__ == "__main__":
    main()
