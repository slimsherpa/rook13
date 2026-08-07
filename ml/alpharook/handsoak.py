"""P2 step 1 — hand-boundary score states under the NEW play core.

Self-play full games with the frozen core making every card play (house
reflex auction unchanged — the winprob table describes the game the
CURRENT bidder plays under the NEW card play), logging one row per game
in exactly the shape winprob.fit() consumes:

    {"w": <winning team>, "hands": [{"scores": [s0, s1]}, ...]}

The gene-gym bequest (winprob24.json) was fitted on gen23-league games;
"knows it wins at 505" under the new core needs these regenerated
states. Late-game nerve and early-game patience fall out of this table,
not tuning.

    ~/torch-env/bin/python -m alpharook.handsoak --minutes 120 --workers 14 \
        --core anytime --out runs/p2/hands

Shards: <out>/hands_s<worker>.jsonl (winprob.fit globs "*/hands_s*").
"""

from __future__ import annotations

import argparse
import json
import os
import time

import torch

from .beliefs import BeliefOracle
from .duel import deck_stream
from .env import SelfPlayGame
from .model import load_qnet
from .widowtwin import make_core


def worker(worker_id: int, args, run_tag: str):
    torch.set_num_threads(1)
    net = load_qnet(args.net)
    net.eval()
    belief = (BeliefOracle(args.belief, temp=args.belief_temp)
              if args.belief else None)
    core = make_core(args.core, net, belief)
    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, f"hands_s{run_tag}{worker_id}.jsonl")
    f = open(path, "a")
    t_end = time.time() + args.minutes * 60
    seed = args.seed_base + worker_id * 10_000_000
    parent = os.getppid()
    n = 0
    while time.time() < t_end:
        if os.getppid() != parent:
            return
        seed += 1
        env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed),
                           dealer=seed % 4)
        hands = []
        last_hn = 0
        with torch.no_grad():
            while not env.done:
                seat, dtype, cands = env.decision()
                if env.g.hand_number != last_hn:
                    last_hn = env.g.hand_number
                    hands.append({"scores": [int(env.g.scores[0]),
                                             int(env.g.scores[1])]})
                pick = (cands[0] if len(cands) == 1
                        else core(env, seat, dtype, cands))
                env.apply(pick)
        if env.g.winner is None:
            continue     # clock-limited abandon; only finished games teach
        f.write(json.dumps({"w": int(env.g.winner), "hands": hands}) + "\n")
        f.flush()
        n += 1
        if worker_id == 0 and n % 5 == 0:
            print(f"  [w0] {n} games, {(t_end - time.time()) / 60:.0f} min "
                  f"left", flush=True)
    f.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=60)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--net", default="models/gen21-cand1.pt")
    ap.add_argument("--belief", default="models/gen15.pt")
    ap.add_argument("--belief-temp", type=float, default=0.5)
    ap.add_argument("--core", default="anytime",
                    choices=["reflex", "cosmo", "anytime"])
    ap.add_argument("--out", default="runs/p2/hands")
    ap.add_argument("--seed-base", type=int, default=25_000_000_000)
    ap.add_argument("--run-tag", default="")
    args = ap.parse_args()
    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    procs = [ctx.Process(target=worker, args=(w, args, args.run_tag))
             for w in range(args.workers)]
    for p in procs:
        p.start()
    print(f"hand soak: {args.workers} workers, {args.minutes} min, "
          f"core={args.core} -> {args.out}", flush=True)
    for p in procs:
        p.join()
    print("HANDSOAK RUN DONE", flush=True)


if __name__ == "__main__":
    main()
