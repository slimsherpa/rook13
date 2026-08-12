#!/usr/bin/env python3
"""Gardner spot-check: partner-lead positions, both bots' picks, no grades.

Generates self-play hands (reflex-driven for speed), pauses at every
partner-of-buyer lead in tricks 0-2, and records what vanilla RC1 and
Gardner-RC1 would each play from the same state — plus the convention
that fired and the priced gap. Output: JSON for the spot-check page.

    ~/torch-env/bin/python scripts/gardner_spotcheck.py --spots 36
"""

import argparse
import json
import sys
import os
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import torch

from rook.cards import team_of, suit_of, num_of, SEAT_NAMES, SUIT_NAMES


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spots", type=int, default=36)
    ap.add_argument("--budget", type=float, default=0.15)
    ap.add_argument("--tau", type=float, default=4.0)
    ap.add_argument("--out", default="runs/gardner/spotcheck.json")
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

    net = load_qnet("models/gen21-cand1.pt")
    net.eval()
    belief = BeliefOracle("models/gen15.pt", temp=0.5)
    vanilla = AnytimeRookAgent(net, belief, budget_scale=args.budget,
                               seed=99)
    g_inner = AnytimeRookAgent(net, belief, budget_scale=args.budget,
                               seed=99)
    gardner = GardnerAgent(g_inner, tau_style=args.tau)

    spots = []
    seed = 7_700_000
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
                _, qmap = vanilla._reflex_q(env, s, dt, cands)
                v_pick = vanilla.choose(env, s, dt, cands)
                v_means = {}
                if vanilla.last_search:
                    _, _, vuse, vvals = vanilla.last_search
                    v_means = {c: round(v, 1)
                               for c, v in zip(vuse, vvals)}
                v_k = (vanilla.last_think or {}).get("k", 0)
                v_stop = (vanilla.last_think or {}).get("stop")
                v_confirm = vanilla.last_confirm
                g_pick = gardner.choose(env, s, dt, cands)
                conv = partner_convention(g.hands[s], g.trump, cands)
                means = {}
                if gardner.last_search:
                    _, _, use, vals = gardner.last_search
                    means = {c: round(v, 1) for c, v in zip(use, vals)}
                spots.append(dict(
                    seed=seed, hand=hand_no + 1,
                    trick=len(g.completed_tricks),
                    seat=SEAT_NAMES[s],
                    buyer=SEAT_NAMES[g.bid_winner],
                    bid=g.high_bid, trump=g.trump,
                    hand_cards=sorted(g.hands[s]),
                    prev_tricks=_tricks(g),
                    legal=sorted(cands),
                    vanilla=v_pick, gardner=g_pick,
                    convention=conv,
                    diverge=int(v_pick != g_pick),
                    means=means, v_means=v_means,
                    q={c: round(qmap[c], 4) for c in cands},
                    g_k=(gardner.last_think or {}).get("k", 0),
                    g_stop=(gardner.last_think or {}).get("stop"),
                    g_confirm=g_inner.last_confirm,
                    v_k=v_k, v_stop=v_stop, v_confirm=v_confirm))
                print(f"spot {len(spots)}/{args.spots} "
                      f"(seed {seed} h{hand_no+1} t{len(g.completed_tricks)}) "
                      f"v={v_pick} g={g_pick} "
                      f"{'DIVERGE' if v_pick != g_pick else 'same'}",
                      flush=True)
                env.apply(v_pick)
                continue
            # everything else: fast reflex
            pick = cands[0] if len(cands) == 1 else model_choose(
                net, "cpu", env, s, dt, cands)
            env.apply(pick)
    print(f"done in {time.time()-t0:.0f}s; "
          f"{sum(x['diverge'] for x in spots)}/{len(spots)} diverge")
    json.dump(spots, open(args.out, "w"))


def _tricks(g):
    # completed_tricks: (leader, [(seat, card), ...], winner, points)
    return [dict(leader=int(t[0]),
                 plays=[[int(s), int(c)] for s, c in t[1]],
                 winner=int(t[2]))
            for t in g.completed_tricks]


if __name__ == "__main__":
    main()
