"""Opening-lead critique cards — Riley's eyeball instrument (2026-08-09).

"If you showed me someone's hand, who took it, what trump is, and which
card they picked — or the temperatures of each of their cards — I could
tell you if it feels good or not."

Samples opening leads (first card of a hand's first trick) from the belief
soak corpus, replays each to the exact decision state, and records:
  * the leader's full hand, trump, bid, buyer position, scores
  * the bot's actual recorded pick + the bare reflex pick
  * TEMPERATURES: mean family-value per candidate over K bel15 worlds
    (the searcher's own felt heat, same organs as live play)
  * god's exact values on the true deal (the retrospective verdict)

    ~/torch-env/bin/python -m alpharook.leadcards --n 36 \
        --out runs/leadcards.json --workers 8
"""

from __future__ import annotations

import argparse
import glob
import json
import random

import torch

from rook.cards import team_of, suit_of, num_of, SUIT_NAMES, card_points
from .anytime import AnytimeRookAgent, observe
from .beliefs import BeliefOracle
from .duel import deck_stream
from .encoder import D_PLAY
from .env import SelfPlayGame
from .model import load_qnet


def collect_leads(paths, want, rng):
    """(rec, decision_index) pairs for opening leads, sampled across games."""
    picked = []
    for path in paths:
        for line in open(path):
            if rng.random() > 0.15:
                continue
            rec = json.loads(line)
            # find first-play-of-hand indices by simulating trick state
            # cheaply: replay below does it exactly; here just tag the game
            picked.append(rec)
    rng.shuffle(picked)
    return picked[: want * 3]  # 3x oversample; replay may reject some


def measure_game(rec, ag, god, k, rng, max_rows=1):
    env = SelfPlayGame(seed=rec["seed"], deck_fn=deck_stream(rec["seed"]),
                       dealer=rec["seed"] % 4,
                       win_score=rec.get("win", 500),
                       lose_score=rec.get("lose", -250))
    rows = []
    target_hand = rng.randrange(3, 10)  # mid-game variety
    with torch.no_grad():
        for (seat, dtype, action, reflex, searched, is_side0) in rec["d"]:
            e_seat, e_dtype, cands = env.decision()
            if e_seat != seat or e_dtype != dtype:
                return rows  # drift (rule-version mismatch); skip game
            g = env.g
            if (dtype == D_PLAY and len(g.completed_tricks) == 0
                    and len(g.trick_plays) == 0 and len(cands) > 1
                    and g.hand_number >= target_hand and not rows):
                o = observe(g, seat)
                probs = None
                try:
                    probs = ag.belief.posterior(env, seat, o, D_PLAY, cands)
                except Exception:
                    pass
                my_team = team_of(seat)
                bid_team = team_of(g.bid_winner)
                wrng = random.Random(rec["seed"] ^ 0xFEED)
                sel = {c: [] for c in cands}
                got = 0
                for _ in range(k * 3):
                    if got >= k:
                        break
                    wv = ag._world_values(o, g, list(cands), wrng, probs,
                                          bid_team, g.high_bid, my_team)
                    if wv is None:
                        continue
                    for c in cands:
                        sel[c].append(wv[c])
                    got += 1
                if got < k // 2:
                    return rows
                temps = {c: sum(v) / got for c, v in sel.items()}
                gv = god._world_values(o, g, list(cands), random.Random(1),
                                       None, bid_team, g.high_bid, my_team)
                _, qmap = ag._reflex_q(env, seat, D_PLAY, list(cands))
                rel = (g.bid_winner - seat) % 4
                rows.append(dict(
                    seed=rec["seed"], hand=g.hand_number, seat=seat,
                    hand_cards=sorted(g.hands[seat]),
                    trump=g.trump, bid=g.high_bid,
                    buyer_rel=["me", "lho", "partner", "rho"][rel],
                    declarer=int(bid_team == my_team),
                    scores=[int(g.scores[my_team]),
                            int(g.scores[1 - my_team])],
                    go_down_pts=int(g.go_down_points())
                    if bid_team == my_team else None,
                    picked=int(action),
                    reflex=int(max(cands, key=lambda c: qmap[c])),
                    temps={str(c): round(temps[c], 1) for c in cands},
                    god={str(c): round(gv[c], 1) for c in cands}
                    if gv else None,
                    k=got))
            env.apply(action)
            if len(rows) >= max_rows:
                return rows
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default="runs/belief/soak_box*_acts.jsonl")
    ap.add_argument("--net", default="models/gen21-cand1.pt")
    ap.add_argument("--belief", default="models/gen15.pt")
    ap.add_argument("--belief-temp", type=float, default=0.5)
    ap.add_argument("--n", type=int, default=36)
    ap.add_argument("--k", type=int, default=24)
    ap.add_argument("--seed", type=int, default=13)
    ap.add_argument("--out", default="runs/leadcards.json")
    args = ap.parse_args()
    rng = random.Random(args.seed)
    paths = sorted(glob.glob(args.corpus))
    games = collect_leads(paths, args.n, rng)
    net = load_qnet(args.net)
    net.eval()
    belief = BeliefOracle(args.belief, temp=args.belief_temp)
    ag = AnytimeRookAgent(net, belief, contam_p=0.0)
    god = AnytimeRookAgent(net, belief, contam_p=1.0)
    rows = []
    for rec in games:
        if len(rows) >= args.n:
            break
        rows += measure_game(rec, ag, god, args.k, rng)
        print(f"  {len(rows)}/{args.n}", flush=True)
    with open(args.out, "w") as f:
        json.dump(rows, f)
    print(f"{len(rows)} lead cards -> {args.out}")


if __name__ == "__main__":
    main()
