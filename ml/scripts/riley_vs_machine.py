#!/usr/bin/env python3
"""Riley vs the machine: K768 verdicts on his six disputed spots.

Rebuilds each disputed spot-check position (deterministic seeds, same
reflex-driven generation path as gardner_spotcheck.py), then prices
EVERY legal card with the anytime searcher's deterministic replay at
K=768 selection worlds — ~16x the gate depth, the deepest instrument in
the shop. Banks per-card means + the confirm outcome.

    ~/torch-env/bin/python scripts/riley_vs_machine.py
"""

import json
import sys
import os
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import torch

from rook.cards import team_of, SEAT_NAMES


def main():
    torch.set_num_threads(3)
    from alpharook.model import load_qnet
    from alpharook.arena import model_choose
    from alpharook.beliefs import BeliefOracle
    from alpharook.anytime import AnytimeRookAgent
    from alpharook.encoder import D_PLAY
    from alpharook.env import SelfPlayGame
    from alpharook.duel import deck_stream

    net = load_qnet("models/gen21-cand1.pt")
    net.eval()
    belief = BeliefOracle("models/gen15.pt", temp=0.5)
    deep = AnytimeRookAgent(net, belief, seed=99, k_max=768)

    want = json.load(open("runs/gardner/riley_spots.json"))
    by_seed = {}
    for w in want:
        by_seed.setdefault(w["seed"], []).append(w)

    out = []
    for seed, targets in sorted(by_seed.items()):
        env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed),
                           dealer=seed % 4)
        hand_no = 0
        # walk the same generation path: reflex everywhere, vanilla-
        # anytime at partner leads (the spotcheck applied v_pick there)
        shadow = AnytimeRookAgent(net, belief, budget_scale=0.15, seed=99)
        while not env.done and hand_no < 5:
            hand_no = len(env.g.hand_history)
            s, dt, cands = env.decision()
            g = env.g
            is_partner_lead = (
                dt == D_PLAY and len(cands) > 1
                and len(g.trick_plays) == 0
                and g.bid_winner is not None and g.trump is not None
                and len(g.completed_tricks) <= 2
                and team_of(s) == team_of(g.bid_winner)
                and s != g.bid_winner)
            hit = None
            if is_partner_lead:
                for w in targets:
                    if (w["hand"] == hand_no + 1
                            and w["trick"] == len(g.completed_tricks)
                            and SEAT_NAMES[s] == w["seat"]
                            and "done" not in w):
                        if sorted(g.hands[s]) != sorted(w["hand_cards"]):
                            print(f"page #{w['page']}: path drifted, "
                                  f"hand mismatch — skipping", flush=True)
                            w["done"] = True
                        else:
                            hit = w
                        break
            if hit:
                t0 = time.time()
                from alpharook.gardner import CAND_CAP  # noqa: F401
                _, qmap = deep._reflex_q(env, s, dt, cands)
                use = list(cands)          # EVERY legal card priced
                pick, k, ke, tos, stop, means = deep._think(
                    env, s, use, qmap, deadline=float("inf"),
                    replay_k=768)
                hit["done"] = True
                out.append(dict(
                    page=hit["page"], seed=seed, hand=hit["hand"],
                    trick=hit["trick"], seat=hit["seat"],
                    legal=sorted(cands),
                    k=k, ke=ke, stop=stop, pick=int(pick),
                    means={str(c): round(v, 2)
                           for c, v in means.items()},
                    confirm=deep.last_confirm,
                    secs=round(time.time() - t0, 1)))
                json.dump(out, open(
                    "runs/gardner/riley_vs_machine.json", "w"), indent=1)
                print(f"page #{hit['page']} done in {out[-1]['secs']}s "
                      f"(k={k}, pick={pick})", flush=True)
            if is_partner_lead:
                pick2 = shadow.choose(env, s, dt, cands)
                env.apply(pick2)
            else:
                env.apply(cands[0] if len(cands) == 1 else model_choose(
                    net, "cpu", env, s, dt, cands))
    print("all spots graded", flush=True)


if __name__ == "__main__":
    main()
