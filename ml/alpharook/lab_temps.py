"""Fill the Laboratory's first-card items with RC1's temperatures.

For each milled lead position (seed+hand), replay the corpus game to the
opening-lead decision and price every legal card over K bel15 worlds with
the production organs — the same "pink circles" Riley graded in the
artifact deck, now for all 400 lab leads. Writes the items back out with
a `temps` map (card -> mean family value).

    ~/torch-env/bin/python -m alpharook.lab_temps \
        --items public/lab/firstcard_items.json --k 24 --workers 14 \
        --out firstcard_items_temps.json
"""

from __future__ import annotations

import argparse
import glob
import json
import random

import torch

from rook.cards import team_of
from .anytime import AnytimeRookAgent, observe
from .beliefs import BeliefOracle
from .duel import deck_stream
from .encoder import D_PLAY
from .env import SelfPlayGame
from .model import load_qnet


def temps_for_item(item, rec, ag, k):
    env = SelfPlayGame(seed=rec["seed"], deck_fn=deck_stream(rec["seed"]),
                       dealer=rec["seed"] % 4,
                       win_score=rec.get("win", 500),
                       lose_score=rec.get("lose", -250))
    with torch.no_grad():
        for (seat, dtype, action, reflex, searched, side0) in rec["d"]:
            e_seat, e_dtype, cands = env.decision()
            if e_seat != seat or e_dtype != dtype:
                return None
            g = env.g
            if (dtype == D_PLAY and g.hand_number == item["hand"]
                    and seat == item["seat"]
                    and len(g.completed_tricks) == 0
                    and len(g.trick_plays) == 0):
                o = observe(g, seat)
                probs = None
                try:
                    probs = ag.belief.posterior(env, seat, o, D_PLAY, cands)
                except Exception:
                    pass
                rng = random.Random(rec["seed"] ^ 0xAB1E)
                sel = {c: [] for c in cands}
                got = 0
                for _ in range(k * 3):
                    if got >= k:
                        break
                    wv = ag._world_values(o, g, list(cands), rng, probs,
                                          team_of(g.bid_winner), g.high_bid,
                                          team_of(seat))
                    if wv is None:
                        continue
                    for c in cands:
                        sel[c].append(wv[c])
                    got += 1
                if got < k // 2:
                    return None
                return {str(c): round(sum(v) / got, 1)
                        for c, v in sel.items()}
            env.apply(action)
    return None


def _worker(t):
    wid, nw, items, k = t
    torch.set_num_threads(1)
    net = load_qnet("models/gen21-cand1.pt")
    net.eval()
    ag = AnytimeRookAgent(net, BeliefOracle("models/gen15.pt", temp=0.5))
    # index the corpus by seed once (flip=0 mainline games)
    idx = {}
    for p in glob.glob("runs/belief/soak_box*_acts.jsonl"):
        for line in open(p):
            r = json.loads(line)
            if r["seed"] not in idx and r.get("flip", 0) == 0:
                idx[r["seed"]] = r
    out = []
    for i, item in enumerate(items):
        if i % nw != wid:
            continue
        rec = idx.get(item["seed"])
        t2 = temps_for_item(item, rec, ag, k) if rec else None
        out.append((item["id"], t2))
        if wid == 0 and len(out) % 5 == 0:
            print(f"  [w0] {len(out)} done", flush=True)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--items", required=True)
    ap.add_argument("--k", type=int, default=24)
    ap.add_argument("--workers", type=int, default=14)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    items = json.load(open(args.items))
    import multiprocessing as mp
    jobs = [(w, args.workers, items, args.k) for w in range(args.workers)]
    with mp.get_context("spawn").Pool(args.workers) as pool:
        results = pool.map(_worker, jobs)
    temps = {}
    for chunk in results:
        for iid, t in chunk:
            temps[iid] = t
    n_ok = sum(1 for v in temps.values() if v)
    for it in items:
        it["temps"] = temps.get(it["id"])
    with open(args.out, "w") as f:
        json.dump(items, f)
    print(f"{n_ok}/{len(items)} items got temps -> {args.out}")


if __name__ == "__main__":
    main()
