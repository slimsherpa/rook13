#!/usr/bin/env python3
"""Style-retention fingerprint (Gen26 battery §4).

At partner-of-buyer lead spots (the Gardner flavor's home turf), three
agents answer the same position:

  ref    the prod stack — gen21 + anytime@0.25 + Gardner shape (-4.0)
  bare   Gen26 reflex alone (the instant tier)
  think  Gen26 + anytime@0.25, QCAL prior_scale 48, NO wrapper
         (the DayDream tier — style must live in the organ)

The §4 question: does search UN-Gardner the organ? Key metric: of the
spots where bare Gen26 plays the v1 convention card, how often does
think override away from it (retention = 1 - that rate). Plus agreement
of each agent with the ref stack's pick and with the convention nominee.

    ~/torch-env/bin/python scripts/styleprint.py --spots 200
"""

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import torch

from rook.cards import team_of, SEAT_NAMES


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spots", type=int, default=200)
    ap.add_argument("--budget", type=float, default=0.25)
    ap.add_argument("--prior-scale", type=float, default=48.0)
    ap.add_argument("--gen26", default="runs/gen26v0b/best.pt")
    ap.add_argument("--out", default="runs/gen26/styleprint.json")
    args = ap.parse_args()

    torch.set_num_threads(2)
    from alpharook.model import load_qnet
    from alpharook.arena import model_choose
    from alpharook.beliefs import BeliefOracle
    from alpharook.anytime import AnytimeRookAgent
    from alpharook.gardner import GardnerAgent, partner_convention
    from alpharook.encoder import D_PLAY
    from alpharook.env import SelfPlayGame
    from alpharook.duel import deck_stream

    n21 = load_qnet("models/gen21-cand1.pt")
    n26 = load_qnet(args.gen26)
    belief = BeliefOracle("models/gen15.pt", temp=0.5)
    ref = GardnerAgent(
        AnytimeRookAgent(n21, belief, budget_scale=args.budget, seed=99),
        tau_style=4.0, mode="shape")
    think = AnytimeRookAgent(n26, belief, budget_scale=args.budget,
                             prior_scale=args.prior_scale, seed=99)

    spots = []
    seed = 8_800_000
    t0 = time.time()
    while len(spots) < args.spots:
        seed += 1
        env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed),
                           dealer=seed % 4)
        hand_no = 0
        while not env.done and hand_no < 4:
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
            if is_partner_lead and len(spots) < args.spots:
                conv = partner_convention(g.hands[s], g.trump, cands)
                r_pick = ref.choose(env, s, dt, cands)
                b_pick = model_choose(n26, "cpu", env, s, dt, cands)
                t_pick = think.choose(env, s, dt, cands)
                spots.append(dict(
                    seed=seed, hand=hand_no + 1,
                    trick=len(g.completed_tricks),
                    seat=SEAT_NAMES[s], trump=g.trump,
                    convention=conv, legal=sorted(cands),
                    ref=r_pick, bare=b_pick, think=t_pick,
                    t_overrode=(think.last_think or {}).get(
                        "overrode", 0)))
                if len(spots) % 10 == 0:
                    print(f"spot {len(spots)}/{args.spots}", flush=True)
                env.apply(r_pick)
                continue
            pick = cands[0] if len(cands) == 1 else model_choose(
                n21, "cpu", env, s, dt, cands)
            env.apply(pick)

    n = len(spots)
    conv_spots = [x for x in spots if x["convention"] is not None]
    bare_conv = [x for x in conv_spots if x["bare"] == x["convention"]]
    kept = sum(1 for x in bare_conv if x["think"] == x["bare"])

    def rate(f):
        m = sum(1 for x in spots if f(x))
        return f"{m}/{n} ({100 * m / n:.1f}%)"

    print(f"\nSTYLEPRINT — {n} partner-lead spots "
          f"({len(conv_spots)} with a v1 convention nominee), "
          f"{time.time() - t0:.0f}s")
    print(f"  agree with ref stack:  bare {rate(lambda x: x['bare'] == x['ref'])}"
          f" | think {rate(lambda x: x['think'] == x['ref'])}")
    if conv_spots:
        cn = len(conv_spots)
        for k in ("ref", "bare", "think"):
            m = sum(1 for x in conv_spots if x[k] == x["convention"])
            print(f"  plays convention card ({k}): {m}/{cn} "
                  f"({100 * m / cn:.1f}%)")
    if bare_conv:
        print(f"  RETENTION — think keeps bare's convention card: "
              f"{kept}/{len(bare_conv)} "
              f"({100 * kept / len(bare_conv):.1f}%)  "
              f"<- the §4 number (high = search does not un-Gardner)")
    print(f"  think overrode its own reflex: "
          f"{sum(x['t_overrode'] for x in spots)}/{n}")
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    json.dump(spots, open(args.out, "w"))


if __name__ == "__main__":
    main()
