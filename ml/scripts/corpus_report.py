#!/usr/bin/env python3
"""The 48-hour deep dive: what actually happened inside the t0 corpus.

Reads the measurement dumps (one JSON line per game: final scores, per-hand
history) and answers Riley's questions per SIDE — A = gen21+t0 (the
teacher), B = bare gen21:

  average final scores, final-score distributions,
  bid distribution, make/set rate at each bid level,
  contracts bought, points per hand, sweeps,
  redeal count/rate (exact, from replaying a sample of corpus games —
  the engine's redeal_count is not in the dumps).

Duplicates from resume relaunches are dropped on (seed, flip); games
without a seed (pre-corpus-era) are skipped so every number here comes
from the same games the mimic will train on.

Usage:
  corpus_report.py <runs-dir> [--redeal-sample N] > report.json
"""
import glob
import json
import os
import sys
from collections import Counter, defaultdict

RUNS = sys.argv[1] if len(sys.argv) > 1 else "runs"
REDEAL_N = (int(sys.argv[sys.argv.index("--redeal-sample") + 1])
            if "--redeal-sample" in sys.argv else 2000)


def load_games(pats):
    seen = set()
    for pat in pats:
        for p in sorted(glob.glob(os.path.join(RUNS, pat))):
            for line in open(p):
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                if "seed" not in r:
                    continue
                k = (r["seed"], r["flip"])
                if k in seen:
                    continue
                seen.add(k)
                yield r


def side_stats(games):
    s = dict(
        n=0, wins_a=0, hands=0,
        score_sum={"A": 0, "B": 0},
        score_hist={"A": Counter(), "B": Counter()},   # 250-pt buckets
        bids={"A": Counter(), "B": Counter()},          # bid -> [n]
        sets={"A": Counter(), "B": Counter()},          # bid -> sets
        pts={"A": 0, "B": 0},                           # per-hand diff sums
        sweeps=0, pair_seen={},
    )
    for r in games:
        s["n"] += 1
        s["wins_a"] += 1 if r["w"] == 0 else 0
        s["hands"] += r["hands"]
        s["score_sum"]["A"] += r["a"]
        s["score_sum"]["B"] += r["b"]
        s["score_hist"]["A"][r["a"] // 250 * 250] += 1
        s["score_hist"]["B"][r["b"] // 250 * 250] += 1
        # hh rows: [bidder_side (0=A), bid, made, hand diff for A]
        for bidder, bid, made, diff in r["hh"]:
            side = "A" if bidder == 0 else "B"
            s["bids"][side][bid] += 1
            if not made:
                s["sets"][side][bid] += 1
            s["pts"]["A"] += diff
        # sweep bookkeeping: both games of a pair won by same side
        ps = s["pair_seen"].setdefault(r["seed"], [])
        ps.append(r["w"])
    s["pairs"] = sum(1 for v in s["pair_seen"].values() if len(v) == 2)
    s["sweeps_a"] = sum(1 for v in s["pair_seen"].values()
                        if len(v) == 2 and v == [0, 0])
    s["sweeps_b"] = sum(1 for v in s["pair_seen"].values()
                        if len(v) == 2 and v == [1, 1])
    del s["pair_seen"]
    return s


def redeal_stats(sample_n):
    """Replay a sample of corpus games; count engine redeals exactly."""
    sys.path.insert(0, os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..")))
    from alpharook.duel import deck_stream
    from alpharook.env import SelfPlayGame
    games = hands = redeals = 0
    for pat in ("t0corpus_box*.jsonl", "t0corpus_mbp_x*.jsonl",
                "t0corpus_std_*.jsonl"):
        for p in sorted(glob.glob(os.path.join(RUNS, pat))):
            with open(p) as f:
                for line in f:
                    if games >= sample_n:
                        break
                    try:
                        r = json.loads(line)
                    except Exception:
                        continue
                    win = r.get("win", 500 if "_std_" in p else 2000)
                    lose = r.get("lose", -250 if "_std_" in p else -1000)
                    env = SelfPlayGame(seed=r["seed"],
                                       deck_fn=deck_stream(r["seed"]),
                                       dealer=r["seed"] % 4,
                                       win_score=win, lose_score=lose)
                    try:
                        for d in r["d"]:
                            env.decision()
                            env.apply(d[2])
                    except Exception:
                        continue
                    games += 1
                    hands += r["hands"]
                    redeals += env.g.redeal_count
            if games >= sample_n:
                break
    return dict(sample_games=games, sample_hands=hands, redeals=redeals,
                redeals_per_game=round(redeals / games, 4) if games else 0,
                redeal_pct_of_hands=round(redeals / (hands + redeals) * 100, 3)
                if hands else 0)


def pack(s):
    out = dict(
        games=s["n"], hands=s["hands"], pairs=s["pairs"],
        a_win_pct=round(s["wins_a"] / s["n"] * 100, 2),
        sweeps_a=s["sweeps_a"], sweeps_b=s["sweeps_b"],
        avg_final={k: round(v / s["n"], 1)
                   for k, v in s["score_sum"].items()},
        avg_pts_per_hand_a=round(s["pts"]["A"] / s["hands"], 2),
        score_hist={k: dict(sorted(v.items()))
                    for k, v in s["score_hist"].items()},
    )
    for side in ("A", "B"):
        tbl = {}
        for bid in sorted(s["bids"][side]):
            n = s["bids"][side][bid]
            st = s["sets"][side][bid]
            tbl[bid] = dict(contracts=n, sets=st,
                            set_pct=round(st / n * 100, 1))
        out[f"bids_{side}"] = tbl
        tot = sum(s["bids"][side].values())
        tot_set = sum(s["sets"][side].values())
        out[f"contracts_{side}"] = tot
        out[f"set_pct_{side}"] = round(tot_set / tot * 100, 1) if tot else 0
        out[f"avg_bid_{side}"] = round(
            sum(b * n for b, n in s["bids"][side].items()) / tot, 1) \
            if tot else 0
    return out


mar = pack(side_stats(load_games(
    ["g21_vs_t0_box*.jsonl", "g21_vs_t0_mbp_x*.jsonl"])))
std = pack(side_stats(load_games(
    ["g21_vs_t0_std_box*.jsonl", "g21_vs_t0_std_mbp.jsonl"])))
red = redeal_stats(REDEAL_N)

print(json.dumps(dict(marathon=mar, standard=std, redeals=red), indent=1))
