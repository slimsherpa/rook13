"""BidBot's measurement corpus (gen24 B-track, 2026-08-02).

The treasure map's loudest number: 35.4% of bought contracts are
unmakeable at par (median overbuy 15 pts). This module generates the
instrument that prices that leak per hand — and later becomes the
training food for the calibrated P(make | dealt nine, auction, bid)
model (the "better hand evaluator, learned not tuned" the bid-gym
postmortem said is the only thing that could beat the house).

One row per completed hand of natural gen21 self-play (family format):
  - the declarer's DEALT NINE (what the bid was actually priced on),
    the widow they picked up, their go-down and trump (hindsight fields
    for study, never bid-time inputs)
  - the full auction transcript (engine bid_history: who opened, every
    raise, backouts) + dealer + score state at the deal
  - the outcome under real gen21 play: made, hand scores, points taken
  - PAR at play start (one exact solve, ~60ms): what the contract could
    have delivered at perfect play — the referee's answer

Design laws honored: measurement doubles as production (rows train the
later net); per-hand currency; raw-replayable (seed + hand number);
labels may see hindsight (par), inputs never will.

    ~/torch-env/bin/python -m alpharook.bidbot_data --minutes 20 --workers 3

Shards: runs/gen24/bidbot/shards/<tag>_wN_XXXX.jsonl
"""

from __future__ import annotations

import argparse
import json
import os
import time

import torch

from rook.cards import CARD_POINTS, team_of
from rook.engine import PLAYING
from rook import solver as S
from .arena import model_choose
from .duel import deck_stream
from .env import SelfPlayGame
from .model import load_qnet

OUT_DIR = "runs/gen24/bidbot/shards"
HANDS_PER_SHARD = 500


@torch.no_grad()
def harvest_game(net, seed: int):
    """One full gen21 self-play game -> one row per completed hand."""
    env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed), dealer=seed % 4)
    pend = {}   # hand_number -> snapshot dict
    while not env.done:
        seat, dtype, cands = env.decision()
        g = env.g
        if (g.phase == PLAYING and g.hand_number not in pend
                and not g.completed_tricks and not g.trick_plays):
            # play is about to start: auction + widow are settled, nothing
            # has been played — the exact moment par is defined
            par0 = S.solve([list(h) for h in g.hands], g.trump,
                           g.trick_leader,
                           sum(CARD_POINTS[c] for c in g.go_down))
            bw = g.bid_winner
            decl_team = team_of(bw)
            kept9 = sorted(g.hands[bw])
            gd = sorted(g.go_down)
            dealt13 = sorted(kept9 + gd)          # nine dealt + widow
            pend[g.hand_number] = dict(
                seed=seed, hn=g.hand_number, declarer=bw,
                decl_team=decl_team, dealer=g.dealer,
                bid=int(g.high_bid), trump=int(g.trump),
                bids=[int(b) for b in g.bids],
                bid_history=[[int(s2), int(b)] for s2, b in g.bid_history],
                scores=[int(g.scores[0]), int(g.scores[1])],
                kept9=kept9, godown=gd, dealt13=dealt13,
                par_decl=int(par0 if decl_team == 0
                             else S.TOTAL_POINTS - par0))
        env.apply(model_choose(net, "cpu", env, seat, dtype, cands))

    rows = []
    for h in env.g.hand_history:
        hn, bw, bid, trump, hs0, hs1, went_set = h
        sn = pend.get(hn)
        if sn is None or sn["declarer"] != bw:
            continue
        dt = sn["decl_team"]
        sn.update(made=int(not went_set),
                  hand_score=[int(hs0), int(hs1)],
                  decl_pts=int(S.TOTAL_POINTS - (hs1 if dt == 0 else hs0)),
                  par_makes=int(sn["par_decl"] >= bid))
        rows.append(sn)
    return rows


def worker(worker_id: int, args, run_tag: str):
    torch.set_num_threads(1)
    net = load_qnet(args.net)
    net.eval()
    os.makedirs(args.out, exist_ok=True)
    shard_n = 0
    t_end = time.time() + args.minutes * 60
    seed = args.seed_base + worker_id * 10_000_000
    n_rows = n_games = 0
    parent = os.getppid()
    while time.time() < t_end:
        if os.getppid() != parent:
            return
        path = os.path.join(args.out,
                            f"{run_tag}_w{worker_id}_{shard_n:04d}.jsonl")
        tmp = path + ".tmp"
        in_shard = 0
        with open(tmp, "w") as f:
            while in_shard < HANDS_PER_SHARD and time.time() < t_end:
                seed += 1
                for row in harvest_game(net, seed):
                    f.write(json.dumps(row) + "\n")
                    in_shard += 1
                    n_rows += 1
                n_games += 1
        os.replace(tmp, path)
        shard_n += 1
        if worker_id == 0:
            print(f"  [w0] shard {shard_n}: {n_rows} hands / {n_games} "
                  f"games, {(t_end - time.time()) / 60:.0f} min left",
                  flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=20)
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--net", default="models/gen21-cand1.pt")
    ap.add_argument("--out", default=OUT_DIR)
    ap.add_argument("--seed-base", type=int, default=8_000_000_000)
    ap.add_argument("--run-tag", default=None)
    args = ap.parse_args()
    run_tag = args.run_tag or f"b{args.seed_base % 1_000_000:06d}"
    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    procs = [ctx.Process(target=worker, args=(w, args, run_tag))
             for w in range(args.workers)]
    for p in procs:
        p.start()
    print(f"bidbot corpus: {args.workers} workers, {args.minutes} min "
          f"-> {args.out}", flush=True)
    for p in procs:
        p.join()
    print("BIDBOT RUN DONE", flush=True)


if __name__ == "__main__":
    main()
