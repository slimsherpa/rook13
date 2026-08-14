#!/usr/bin/env python3
"""Serving-budget latency profile for the Gardner-RC1 assembly.

Plays fresh self-play hands with the anytime searcher (Gardner layer on)
making every card decision at a given budget_scale, and records the wall
time of each decision, split by decision class:
  open  — the opening lead of a hand (the measured cost wall)
  lead  — later trick leads
  follow — in-trick follows
Reports median / p90 / max per class per budget.

    ~/torch-env/bin/python scripts/latency_profile.py \
        --scales 0.15,0.25,0.5 --hands 12
"""

import argparse
import json
import sys
import os
import statistics
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import torch


def profile(scale, hands_target, threads):
    torch.set_num_threads(threads)
    from alpharook.model import load_qnet
    from alpharook.arena import model_choose
    from alpharook.beliefs import BeliefOracle
    from alpharook.anytime import AnytimeRookAgent
    from alpharook.gardner import GardnerAgent
    from alpharook.encoder import D_PLAY
    from alpharook.env import SelfPlayGame
    from alpharook.duel import deck_stream

    net = load_qnet(NET_PATH)
    net.eval()
    belief = BeliefOracle("models/gen15.pt", temp=0.5)
    inner = AnytimeRookAgent(net, belief, budget_scale=scale, seed=31,
                             **({"prior_scale": PRIOR_SCALE}
                                if PRIOR_SCALE else {}))
    agent = inner if NO_GARDNER else GardnerAgent(inner)
    times = {"open": [], "lead": [], "follow": []}
    seed = 8_800_000
    hands = 0
    while hands < hands_target:
        seed += 1
        env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed),
                           dealer=seed % 4)
        while not env.done and len(env.g.hand_history) < 3:
            s, dt, cands = env.decision()
            if dt == D_PLAY and len(cands) > 1:
                g = env.g
                cls = ("open" if not g.completed_tricks
                       and not g.trick_plays
                       else "lead" if not g.trick_plays else "follow")
                t0 = time.time()
                pick = agent.choose(env, s, dt, cands)
                times[cls].append(time.time() - t0)
            else:
                pick = cands[0] if len(cands) == 1 else model_choose(
                    net, "cpu", env, s, dt, cands)
            env.apply(pick)
        hands = max(hands, len(env.g.hand_history))
        hands_target_done = sum(len(v) for v in times.values())
        if hands_target_done > hands_target * 30:
            break
    rep = {}
    for cls, v in times.items():
        if not v:
            continue
        v = sorted(v)
        rep[cls] = dict(n=len(v),
                        med=round(statistics.median(v), 2),
                        p90=round(v[int(len(v) * 0.9)], 2),
                        max=round(v[-1], 2))
    return rep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scales", default="0.15,0.25,0.5")
    ap.add_argument("--hands", type=int, default=12)
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--net", default="models/gen21-cand1.pt")
    ap.add_argument("--prior-scale", type=float, default=0.0)
    ap.add_argument("--no-gardner", action="store_true")
    ap.add_argument("--out", default="runs/gardner/latency_profile.json")
    args = ap.parse_args()
    global NET_PATH, PRIOR_SCALE, NO_GARDNER
    NET_PATH = args.net
    PRIOR_SCALE = args.prior_scale
    NO_GARDNER = args.no_gardner
    out = {}
    for sc in [float(x) for x in args.scales.split(",")]:
        t0 = time.time()
        rep = profile(sc, args.hands, args.threads)
        out[str(sc)] = rep
        print(f"scale {sc}: {json.dumps(rep)} "
              f"({time.time()-t0:.0f}s total)", flush=True)
    json.dump(out, open(args.out, "w"), indent=1)


if __name__ == "__main__":
    main()
