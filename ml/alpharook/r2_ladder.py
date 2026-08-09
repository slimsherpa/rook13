"""R2 `defense_ladder` — why don't we set people? (FINAL-WEEK-PLAN §6 R2)

The counterfactual set-rate ladder, two rungs after R1 killed rung A
(candidate exclusion is worth 0.3 pts/hand — the menu is fine):

  live (recorded)  →  high-K defense (same bel15 worlds, k=96 forced,
                      same solver/utility/discipline — prices bucket D,
                      finite-sample/budget failure)
                   →  god defense (exact true-deal play — prices the
                      whole remaining wall: B world-model + C valuation
                      + E residue, inseparable until belief25-J lands)

Method: for banked hands where the bidding team MADE its contract, replay
the recorded auction/widow/trump exactly, then play the hand out with the
DEFENDING seats upgraded while the declaring team keeps the live anytime
core at production budgets. Duplicate everything else. Metric: % of made
contracts flipped to sets, plus defender points delta per hand.

The declarer still adapts (fresh searcher, same brain) — this measures
"how would the table have gone", not a frozen-line fantasy.

    ~/torch-env/bin/python -m alpharook.r2_ladder \
        --corpus runs/belief/soak_box1_acts.jsonl --hands 60 \
        --arm god --out runs/r2/r2_god_box1.jsonl --workers 14
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import random

import torch

from rook.cards import team_of
from .anytime import AnytimeRookAgent
from .beliefs import BeliefOracle
from .duel import deck_stream
from .encoder import D_PLAY
from .env import SelfPlayGame
from .god import GodAgent
from .model import load_qnet
from .search import _Sim


def upgraded_choose(arm, ag_live, ag_god, k):
    """Chooser for DEFENDER seats on the upgraded rung."""
    if arm == "god":
        return ag_god.choose
    def highk(env, seat, dtype, cands):
        if dtype != D_PLAY or len(cands) <= 1:
            from .arena import model_choose
            return model_choose(ag_live.net, "cpu", env, seat, dtype, cands)
        return ag_live.replay(env, seat, dtype, cands, k=k, ke=24)
    return highk


def play_out_hand(g, def_team, def_choose, dec_choose, rng):
    """Play the current hand to completion, defenders upgraded."""
    sim = _Sim(g, [], None)
    while not sim.hand_over:
        s, dt, cs = sim.decision()
        if len(cs) == 1:
            sim.apply(cs[0])
            continue
        pick = (def_choose if team_of(s) == def_team else dec_choose)(
            sim, s, dt, cs)
        sim.apply(pick)
    return sim.g.hand_history[-1]


def measure_game(rec, arm, ag_live_dec, ag_live_def, ag_god, k, rng,
                 sample_p):
    env = SelfPlayGame(seed=rec["seed"], deck_fn=deck_stream(rec["seed"]),
                       dealer=rec["seed"] % 4,
                       win_score=rec.get("win", 500),
                       lose_score=rec.get("lose", -250))
    rows = []
    def_choose = upgraded_choose(arm, ag_live_def, ag_god, k)
    handled = set()
    with torch.no_grad():
        for (seat, dtype, action, reflex, searched, is_side0) in rec["d"]:
            e_seat, e_dtype, cands = env.decision()
            if e_seat != seat or e_dtype != dtype:
                return rows
            g = env.g
            hn = g.hand_number
            if (dtype == D_PLAY and hn not in handled
                    and len(g.completed_tricks) == 0
                    and len(g.trick_plays) == 0
                    and rng.random() < sample_p):
                handled.add(hn)
                bid_team = team_of(g.bid_winner)
                gg = g.clone()
                h = play_out_hand(gg, 1 - bid_team, def_choose,
                                  ag_live_dec.choose, rng)
                # hand_history row: (hn, bidder, bid, trump, sc0, sc1, set)
                rows.append(dict(
                    seed=rec["seed"], hand=hn, arm=arm,
                    bid=int(h[2]), bid_team=bid_team,
                    live_made=None,  # filled from the replayed game below
                    cf_set=int(bool(h[6])),
                    cf_def_pts=int(h[5] if bid_team == 0 else h[4]),
                    cf_bid_pts=int(h[4] if bid_team == 0 else h[5])))
            env.apply(action)
    # the replayed game IS the live rung: read each hand's true outcome
    hist = {h[0]: h for h in env.g.hand_history}
    for r in rows:
        h = hist.get(r["hand"])
        if h is not None:
            r["live_made"] = 0 if h[6] else 1
            r["live_def_pts"] = int(h[5] if r["bid_team"] == 0 else h[4])
    return rows


def _run_worker(t):
    (paths, wid, nw, arm, k, out, net_p, belief_p, btemp, sample_p,
     max_hands) = t
    torch.set_num_threads(1)
    net = load_qnet(net_p)
    net.eval()
    belief = BeliefOracle(belief_p, temp=btemp)
    ag_live_dec = AnytimeRookAgent(net, belief)      # declarer, live budgets
    ag_live_def = AnytimeRookAgent(net, belief)      # defender, forced-K
    ag_god = GodAgent(net)
    rng = random.Random(0xD3F ^ wid)
    f = open(out.replace(".jsonl", f"_w{wid}.jsonl"), "a")
    n = 0
    for pi, path in enumerate(paths):
        for gi, line in enumerate(open(path)):
            if (pi * 100_003 + gi) % nw != wid or n >= max_hands:
                continue
            rec = json.loads(line)
            try:
                rows = measure_game(rec, arm, ag_live_dec, ag_live_def,
                                    ag_god, k, rng, sample_p)
            except Exception as e:
                print(f"  [w{wid}] skip {rec.get('seed')}: {e}", flush=True)
                continue
            for r in rows:
                f.write(json.dumps(r) + "\n")
            f.flush()
            n += len(rows)
            if wid == 0 and rows and n % 10 < len(rows):
                print(f"  [w0] {n} hands", flush=True)
    f.close()
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default="runs/belief/soak_box*_acts.jsonl")
    ap.add_argument("--arm", choices=["god", "highk"], required=True)
    ap.add_argument("--k", type=int, default=96)
    ap.add_argument("--net", default="models/gen21-cand1.pt")
    ap.add_argument("--belief", default="models/gen15.pt")
    ap.add_argument("--belief-temp", type=float, default=0.5)
    ap.add_argument("--sample-p", type=float, default=0.35)
    ap.add_argument("--hands", type=int, default=40, help="per worker")
    ap.add_argument("--workers", type=int, default=14)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    paths = sorted(glob.glob(args.corpus))
    assert paths, f"no corpus at {args.corpus}"
    import multiprocessing as mp
    jobs = [(paths, w, args.workers, args.arm, args.k, args.out, args.net,
             args.belief, args.belief_temp, args.sample_p, args.hands)
            for w in range(args.workers)]
    with mp.get_context("spawn").Pool(args.workers) as pool:
        counts = pool.map(_run_worker, jobs)
    rows = []
    for w in range(args.workers):
        p = args.out.replace(".jsonl", f"_w{w}.jsonl")
        if os.path.exists(p):
            rows += [json.loads(l) for l in open(p)]
    live_made = [r for r in rows if r["live_made"] == 1]
    flips = sum(r["cf_set"] for r in live_made)
    all_set = sum(r["cf_set"] for r in rows)
    print(f"\nR2 {args.arm}: {len(rows)} counterfactual hands "
          f"(set-rate {100 * all_set / max(len(rows), 1):.1f}% vs live "
          f"{100 * sum(1 - (r['live_made'] or 0) for r in rows) / max(len(rows), 1):.1f}%)")
    print(f"  of {len(live_made)} live-MADE contracts, upgraded defense "
          f"sets {flips} ({100 * flips / max(len(live_made), 1):.1f}%)")


if __name__ == "__main__":
    main()
