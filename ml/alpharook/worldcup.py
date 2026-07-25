"""THE WORLD CUP (Riley's inter-city tournament, gen22 era).

Runs on the hub. Fetches each city's best banked fighter (best_banked.pt,
written at every selection), then plays a full round-robin — every city
champion plus the frozen gen21 — as mirrored duplicate pairs at marathon
rules on salted HELD-OUT contested decks (the same exam slice no city ever
trains on; per-cup salt so no two cups reuse a paper — law 8).

The headline number is each champion's win rate vs frozen gen21. If the
best of them clears --promote-at (default 55%), the cup automatically runs
the HOUSE PROMOTION BATTERY on ordinary random decks — 150 sprint pairs +
70 marathon pairs, fresh seeds (laws 1-2: nothing under 100 pairs + a
marathon counts, and curated-deck skill must transfer back to the true
deal distribution before anyone calls it a champion).

Results: runs/worldcup/cup_<stamp>.json + one line in
runs/worldcup/history.jsonl (the dashboard reads both).

    python -m alpharook.worldcup \
        --cities provo=local:evo-provo orem=root@5.78.130.139:evo-orem \
        --deck-lib runs/decks/lib.jsonl --pairs 30 --workers 7
"""

from __future__ import annotations

import argparse
import itertools
import json
import subprocess
import time
from pathlib import Path

import torch

from .contested import load_library, CuratedDecks
from .evo import exam_pair, salt
from .league import _rebuild

RUNS_DIR = Path(__file__).resolve().parents[1] / "runs"
CUP_DIR = RUNS_DIR / "worldcup"

_W: dict = {}


def _winit(lib_path, exam_weights, win, lose):
    torch.set_num_threads(1)
    _, exam, _ = load_library(lib_path)
    _W["exam"] = CuratedDecks(exam, exam_weights)
    _W["win"], _W["lose"] = win, lose
    _W["nets"] = {}


def _net(path):
    if path not in _W["nets"]:
        from .model import load_qnet
        _W["nets"][path] = load_qnet(path)
    return _W["nets"][path]


def _wpair(args):
    path_a, path_b, seeds = args
    na, nb = _net(path_a), _net(path_b)
    wins = games = 0
    tally = [[0, 0, 0] for _ in range(3)]
    for ps in seeds:
        w, _h, t = exam_pair(na, nb, _W["exam"], ps, _W["win"], _W["lose"])
        wins += w
        games += 2
        for i in range(3):
            for j in range(3):
                tally[i][j] += t[i][j]
    return wins, games, tally


def fetch_champ(name: str, host: str, run: str, dest: Path) -> dict | None:
    """Copy a city's best_banked.pt here; return its metadata."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    src = f"/root/rook13/ml/runs/{run}/best_banked.pt"
    try:
        if host == "local":
            src = str(RUNS_DIR / run / "best_banked.pt")
            subprocess.run(["cp", src, str(dest)], check=True, timeout=60)
        else:
            subprocess.run(["scp", "-o", "BatchMode=yes",
                            "-o", "ConnectTimeout=10",
                            f"{host}:{src}", str(dest)],
                           check=True, timeout=120,
                           capture_output=True)
        ck = torch.load(dest, map_location="cpu", weights_only=False)
        return {"name": ck.get("name"), "exam_wr": ck.get("exam_wr"),
                "round": ck.get("round"), "city": name}
    except Exception as e:
        print(f"  {name}: no champion fetched ({e})", flush=True)
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cities", nargs="+", required=True,
                    help="name=host:run (host 'local' or user@ip)")
    ap.add_argument("--champion", default="models/gen21-cand1.pt")
    ap.add_argument("--deck-lib", default="runs/decks/lib.jsonl")
    ap.add_argument("--exam-weights", default="0.10,0.30,0.60")
    ap.add_argument("--pairs", type=int, default=30)
    ap.add_argument("--win-score", type=int, default=2000)
    ap.add_argument("--lose-score", type=int, default=-1000)
    ap.add_argument("--workers", type=int, default=7)
    ap.add_argument("--promote-at", type=float, default=0.55,
                    help="cup wr vs gen21 that triggers the random-deck "
                         "promotion battery")
    ap.add_argument("--battery-sprint-pairs", type=int, default=150)
    ap.add_argument("--battery-marathon-pairs", type=int, default=70)
    args = ap.parse_args()

    stamp = time.strftime("%Y-%m-%d_%H%M")
    CUP_DIR.mkdir(parents=True, exist_ok=True)
    exam_w = tuple(float(x) for x in args.exam_weights.split(","))

    entrants = {"gen21": {"path": args.champion,
                          "meta": {"city": "-", "name": "gen21 (frozen)"}}}
    for spec in args.cities:
        name, rest = spec.split("=", 1)
        host, run = rest.split(":", 1)
        dest = CUP_DIR / "champs" / f"{name}.pt"
        meta = fetch_champ(name, host, run, dest)
        if meta is not None:
            entrants[name] = {"path": str(dest), "meta": meta}
    if len(entrants) < 2:
        raise SystemExit("no city champions available yet")
    print(f"WORLD CUP {stamp}: {list(entrants)} | {args.pairs} pairs/pairing "
          f"at {args.lose_score}..{args.win_score} on contested exam decks",
          flush=True)

    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    pool = ctx.Pool(args.workers, initializer=_winit,
                    initargs=(args.deck_lib, exam_w,
                              args.win_score, args.lose_score))

    base = salt("worldcup", stamp)
    pair_seeds = [base + p * 104729 + 1 for p in range(args.pairs)]
    names = list(entrants)
    table = {}
    points = {n: [0, 0] for n in names}   # wins, games
    for a, b in itertools.combinations(names, 2):
        per = max(2, args.pairs // args.workers + 1)
        jobs = [(entrants[a]["path"], entrants[b]["path"],
                 pair_seeds[c:c + per])
                for c in range(0, len(pair_seeds), per)]
        wins = games = 0
        tally = [[0, 0, 0] for _ in range(3)]
        for w, g, t in pool.imap_unordered(_wpair, jobs):
            wins += w
            games += g
            for i in range(3):
                for j in range(3):
                    tally[i][j] += t[i][j]
        skill = sum(t[0] + t[1] for t in tally)
        skill_a = sum(t[0] for t in tally)
        table[f"{a}|{b}"] = {
            "wr_a": round(wins / games, 3), "games": games,
            "skill_share_a": round(skill_a / skill, 3) if skill else None,
            "contested_skill_share_a":
                round(tally[2][0] / (tally[2][0] + tally[2][1]), 3)
                if (tally[2][0] + tally[2][1]) else None}
        points[a][0] += wins
        points[b][0] += games - wins
        points[a][1] += games
        points[b][1] += games
        print(f"  {a} vs {b}: {wins}/{games} ({wins / games:.1%})", flush=True)
    pool.close()
    pool.join()

    standings = sorted(((n, p[0] / max(1, p[1])) for n, p in points.items()),
                       key=lambda kv: -kv[1])
    vs_gen21 = {}
    for n in names:
        if n == "gen21":
            continue
        key, rev = (f"{n}|gen21", False) if f"{n}|gen21" in table \
            else (f"gen21|{n}", True)
        wr = table[key]["wr_a"]
        vs_gen21[n] = round(1 - wr if rev else wr, 3)
    best_city, best_wr = (max(vs_gen21.items(), key=lambda kv: kv[1])
                          if vs_gen21 else (None, 0.0))

    cup = {"stamp": stamp, "ts": time.time(),
           "entrants": {n: e["meta"] for n, e in entrants.items()},
           "pairs": args.pairs, "rules": [args.lose_score, args.win_score],
           "table": table,
           "standings": [[n, round(wr, 3)] for n, wr in standings],
           "vs_gen21": vs_gen21,
           "best": {"city": best_city, "wr_vs_gen21": best_wr}}
    print("STANDINGS: " + "  ".join(f"{n}:{wr:.1%}" for n, wr in standings))
    print("vs gen21: " + "  ".join(f"{n}:{w:.1%}"
                                   for n, w in vs_gen21.items()), flush=True)

    # --- promotion battery: curated skill must transfer to random decks ----
    if best_city and best_wr >= args.promote_at:
        from .duel import Side, duel
        cand = entrants[best_city]["path"]
        print(f"PROMOTION BATTERY: {best_city} hit {best_wr:.1%} — "
              f"random decks, fresh seeds", flush=True)
        bseed = salt("battery", stamp)
        a_args = (cand, "none", None, 0)
        b_args = (args.champion, "none", None, 0)
        sprint = duel(Side(*a_args), Side(*b_args),
                      args.battery_sprint_pairs, seed=bseed,
                      verbose=False, workers=args.workers,
                      side_args=(a_args, b_args))
        marathon = duel(Side(*a_args), Side(*b_args),
                        args.battery_marathon_pairs, seed=bseed + 999,
                        verbose=False, win_score=2000, lose_score=-1000,
                        workers=args.workers, side_args=(a_args, b_args))
        cup["battery"] = {"sprint_wr": round(sprint, 3),
                          "marathon_wr": round(marathon, 3),
                          "sprint_pairs": args.battery_sprint_pairs,
                          "marathon_pairs": args.battery_marathon_pairs}
        print(f"  BATTERY: sprint {sprint:.1%} / marathon {marathon:.1%}",
              flush=True)

    out = CUP_DIR / f"cup_{stamp}.json"
    out.write_text(json.dumps(cup, indent=1))
    with open(CUP_DIR / "history.jsonl", "a") as f:
        f.write(json.dumps(cup) + "\n")
    print(f"cup written: {out}", flush=True)


if __name__ == "__main__":
    main()
