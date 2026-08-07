"""P2 — TWIN GAMES: the bid-repricing corpus generator.

Nobody writes bidding rules. Play the same deal twice — identical cards,
ONE different bid — under a frozen card-play core, and let the pair of
outcomes say whether that bid helped or hurt the chance of winning the
game to 505. A fresh net later learns from millions of these pairs; the
equilibrium is discovered by measurement, never dictated (the CliffBid
retirement, honored).

One row per twinned decision:
  * full games are played with the HOUSE auction (the reflex net) so
    score states and contract mix stay production-distributed;
  * with probability --twin-p, a live bid decision is twinned: the hand
    continues for real with the house bid (twin A), and a clone plays
    the SAME hand from the SAME state with one deviated bid (twin B) —
    a side branch the real game never sees;
  * the label is dwp = P(win game | scores after B) - P(win | after A)
    for the DEVIATING team, via the winprob table (--winprob path; the
    gene-gym bequest today, REGENERATED under the new core before the
    real soak — the generator only ever reads the file it is given);
  * rows carry (seed, hn, decision ordinal, deviation) — enough to
    replay the twin exactly under the same core, the dump-actions law.

Deviations sample the local bid neighborhood (PASS, the floor, and up
to two raises above the house choice) uniformly — no strategy priors in
the DATA; stratification is the trainer's business.

The standing law stands: this measures bids by TWIN OUTCOMES, never by
live search rollouts at decision time (winner's curse).

    ~/torch-env/bin/python -m alpharook.bidtwins --minutes 20 --workers 8 \
        --core reflex --out runs/p2/twins

Shards: <out>/<tag>_wN.jsonl.
"""

from __future__ import annotations

import argparse
import json
import os
import time

import torch

from rook.cards import PASS, VALID_BIDS, team_of
from rook.engine import BIDDING, HAND_DONE, GAME_OVER
from .arena import model_choose
from .beliefs import BeliefOracle
from .duel import deck_stream
from .encoder import D_BID
from .env import SelfPlayGame
from .model import load_qnet
from .widowtwin import make_core
from .winprob import WinProb


def deviation_menu(g, house_bid) -> list:
    """The local neighborhood of the house choice at this live decision:
    PASS (if legal), the floor, and up to two raises above the house bid.
    The house bid itself is excluded — a twin needs a difference."""
    floor = g.min_next_bid()
    menu = set()
    if not g.must_bid():
        menu.add(PASS)
    if floor is not None:
        menu.add(floor)
        base = floor if house_bid == PASS else house_bid
        for b in VALID_BIDS:
            if base < b <= base + 10:
                menu.add(b)
    menu.discard(house_bid)
    return sorted(menu, key=lambda b: -1 if b == PASS else b)


def finish_hand(sim, core):
    """Play the current hand to HAND_DONE with the core deciding
    everything (auction remainder, widow, trump, play). Returns the
    hand_history row."""
    while not sim.hand_over:
        s, dt, cs = sim.decision()
        pick = cs[0] if len(cs) == 1 else core(sim, s, dt, cs)
        sim.apply(pick)
    return sim.g.hand_history[-1]


def worker(worker_id: int, args, run_tag: str):
    from .search import _Sim
    torch.set_num_threads(1)
    net = load_qnet(args.net)
    net.eval()
    belief = (BeliefOracle(args.belief, temp=args.belief_temp)
              if args.belief else None)
    core = make_core(args.core, net, belief)
    wp = WinProb(args.winprob) if args.winprob else WinProb()
    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, f"{run_tag}_w{worker_id}.jsonl")
    f = open(path, "a")
    t_end = time.time() + args.minutes * 60
    seed = args.seed_base + worker_id * 10_000_000
    parent = os.getppid()
    import random as _random
    rng = _random.Random(args.seed_base ^ (worker_id * 7919))
    n = 0
    while time.time() < t_end:
        if os.getppid() != parent:
            return
        seed += 1
        env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed),
                           dealer=seed % 4)
        dec_ord = 0     # ordinal of BID decisions this game — the replay key
        with torch.no_grad():
            while not env.done and time.time() < t_end:
                seat, dtype, cands = env.decision()
                if dtype == D_BID:
                    dec_ord += 1
                    house = model_choose(net, "cpu", env, seat, D_BID, cands)
                    menu = [b for b in deviation_menu(env.g, house)
                            if b in cands]
                    if menu and rng.random() < args.twin_p:
                        dev = rng.choice(menu)
                        scores0 = list(env.g.scores)
                        team = team_of(seat)
                        # twin B: the side branch with the deviated bid
                        gb = env.g.clone()
                        simb = _Sim(gb, [], None)
                        simb.apply(dev)
                        hb = finish_hand(simb, core)
                        # twin A: the real game continues with the house
                        # bid; play THIS hand out with the same core
                        ga = env.g.clone()
                        sima = _Sim(ga, [], None)
                        sima.apply(house)
                        ha = finish_hand(sima, core)
                        wa = wp(scores0[team] + (ha[4] if team == 0 else ha[5]),
                                scores0[1 - team] + (ha[5] if team == 0 else ha[4]),
                                env.g.win_score, env.g.lose_score)
                        wb = wp(scores0[team] + (hb[4] if team == 0 else hb[5]),
                                scores0[1 - team] + (hb[5] if team == 0 else hb[4]),
                                env.g.win_score, env.g.lose_score)
                        f.write(json.dumps(dict(
                            seed=seed, hn=env.g.hand_number, dec=dec_ord,
                            seat=seat, team=team,
                            scores=scores0,
                            house="pass" if house == PASS else int(house),
                            dev="pass" if dev == PASS else int(dev),
                            hand_a=[int(ha[4]), int(ha[5])],
                            hand_b=[int(hb[4]), int(hb[5])],
                            wp_a=round(wa, 4), wp_b=round(wb, 4),
                            dwp=round(wb - wa, 4))) + "\n")
                        f.flush()
                        n += 1
                        if worker_id == 0 and n % 10 == 0:
                            print(f"  [w0] {n} twins, "
                                  f"{(t_end - time.time()) / 60:.0f} min left",
                                  flush=True)
                    env.apply(house)
                    continue
                pick = model_choose(net, "cpu", env, seat, dtype, cands)
                env.apply(pick)
    f.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=20)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--net", default="models/gen21-cand1.pt")
    ap.add_argument("--belief", default=None,
                    help="belief ckpt (needed for cosmo/anytime cores)")
    ap.add_argument("--belief-temp", type=float, default=0.5)
    ap.add_argument("--core", default="reflex",
                    choices=["reflex", "cosmo", "anytime"])
    ap.add_argument("--winprob", default=None,
                    help="winprob json (default: the gene-gym bequest; "
                         "REGENERATE under the frozen core before the "
                         "real soak)")
    ap.add_argument("--twin-p", type=float, default=0.25)
    ap.add_argument("--out", default="runs/p2/twins")
    ap.add_argument("--seed-base", type=int, default=20_000_000_000)
    ap.add_argument("--run-tag", default=None)
    args = ap.parse_args()
    if args.core in ("cosmo", "anytime"):
        assert args.belief, f"--core {args.core} needs --belief"
    run_tag = args.run_tag or args.core
    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    procs = [ctx.Process(target=worker, args=(w, args, run_tag))
             for w in range(args.workers)]
    for p in procs:
        p.start()
    print(f"bid twins: {args.workers} workers, {args.minutes} min, "
          f"core={args.core}, twin_p={args.twin_p} -> {args.out}",
          flush=True)
    for p in procs:
        p.join()
    print("BIDTWINS RUN DONE", flush=True)


if __name__ == "__main__":
    main()
