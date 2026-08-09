"""Importance-sampled bid marginal — the auction's isolated effect, fast.

The old marginal (p2_gate_keeper role=marginal) burned 92% of its games on
pairs whose auctions never diverged: card-locked noise. This instrument
pre-screens each pair's FIRST deal at a neutral 0-0 score — simulate the
auction under stack A's bidder and under stack B's bidder; if every seat
bids identically, skip the pair entirely. Only divergent pairs are played
(full games, duplicate decks, mirror seats). The unconditional marginal is
the divergent-pair effect scaled by the divergence rate.

Known approximation (accepted, time-boxed): screening is first-deal-at-0-0
only. Pairs whose auctions diverge only in later hands (score-pressure
overrides) are missed; the reported marginal is a floor on |effect|, and
the screen's own divergence rate is reported beside it.

    ~/torch-env/bin/python -m alpharook.bidmarg \
        --bidbot-a models/bidbot-v1.pt --bidbot-b models/bidbot-v0.pt \
        --pairs 120 --workers 14 --seed-base 5010000000 \
        --out runs/bidmarg/v1_vs_v0_box1.jsonl
"""

from __future__ import annotations

import argparse
import json
import os
import random
import time

import torch

from rook.cards import PASS
from .bidbot import BidBot
from .bidtwins import deviation_menu  # noqa: F401 (parity with twins doc)
from .duel import Side, deck_stream, play_duel_game
from .encoder import D_BID
from .env import SelfPlayGame
from .arena import model_choose
from .model import load_qnet


def auction_trace(seed, net, bidbot, win, lose):
    """Bid sequence of the pair's first deal with every seat using the
    given (net, bidbot) stack at 0-0. Returns tuple of bids."""
    env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed),
                       dealer=seed % 4, win_score=win, lose_score=lose)
    trace = []
    with torch.no_grad():
        while not env.done:
            seat, dtype, cands = env.decision()
            if dtype != D_BID:
                break
            house = model_choose(net, "cpu", env, seat, D_BID, cands)
            pick = house
            if bidbot is not None and len(cands) > 1:
                try:
                    pick, _d, _u, _s = bidbot.choose_bid(env, seat,
                                                         cands, house)
                except Exception:
                    pick = house
            trace.append(int(pick))
            env.apply(pick)
    return tuple(trace)


def worker(t):
    (wid, nw, args) = t
    torch.set_num_threads(1)
    net = load_qnet(args.net)
    net.eval()
    bb_a = BidBot(args.bidbot_a, args.winprob, args.tau) \
        if args.bidbot_a else None
    bb_b = BidBot(args.bidbot_b, args.winprob, args.tau) \
        if args.bidbot_b else None
    side_a = Side(args.net, "none", anytime=1.0, mwidow=60,
                  proposer=args.proposer, belief_ckpt=args.belief,
                  belief_temp=0.5, bidbot=args.bidbot_a, bidbot_tau=args.tau)
    side_b = Side(args.net, "none", anytime=1.0, mwidow=60,
                  proposer=args.proposer, belief_ckpt=args.belief,
                  belief_temp=0.5, bidbot=args.bidbot_b, bidbot_tau=args.tau)
    f = open(args.out.replace(".jsonl", f"_w{wid}.jsonl"), "a")
    screened = played = 0
    seed = args.seed_base + wid * 10_000_000
    t_end = time.time() + args.minutes * 60
    while played < args.pairs and time.time() < t_end:
        seed += 1
        screened += 1
        tr_a = auction_trace(seed, net, bb_a, args.win_score, -255)
        tr_b = auction_trace(seed, net, bb_b, args.win_score, -255)
        if tr_a == tr_b:
            continue
        res = [play_duel_game(side_a, side_b, seed, flip,
                              args.win_score, -255)
               for flip in (False, True)]
        for (win_side, diff0, stats, game) in res:
            game["screened_at"] = screened
            f.write(json.dumps(game) + "\n")
        f.flush()
        played += 1
        if wid == 0:
            print(f"  [w0] {played} divergent pairs / {screened} screened "
                  f"({100 * played / screened:.1f}%)", flush=True)
    f.close()
    return screened, played


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--net", default="models/gen21-cand1.pt")
    ap.add_argument("--belief", default="models/gen15.pt")
    ap.add_argument("--proposer", default="models/widowprop-v0.pt")
    ap.add_argument("--winprob", default="models/winprob25.json")
    ap.add_argument("--bidbot-a", default=None)
    ap.add_argument("--bidbot-b", default=None)
    ap.add_argument("--tau", type=float, default=0.05)
    ap.add_argument("--pairs", type=int, default=100, help="per worker")
    ap.add_argument("--minutes", type=float, default=630)
    ap.add_argument("--workers", type=int, default=14)
    ap.add_argument("--seed-base", type=int, required=True)
    ap.add_argument("--win-score", type=int, default=505)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    import multiprocessing as mp
    jobs = [(w, args.workers, args) for w in range(args.workers)]
    with mp.get_context("spawn").Pool(args.workers) as pool:
        res = pool.map(worker, jobs)
    screened = sum(r[0] for r in res)
    played = sum(r[1] for r in res)
    rows = []
    for w in range(args.workers):
        p = args.out.replace(".jsonl", f"_w{w}.jsonl")
        if os.path.exists(p):
            rows += [json.loads(l) for l in open(p)]
    hands = sum(g["hands"] for g in rows)
    diff = sum(h[3] for g in rows for h in g["hh"])
    rate = played / max(screened, 1)
    cond = diff / max(hands, 1)
    print(f"\nbidmarg: {played} divergent pairs of {screened} screened "
          f"(rate {100 * rate:.1f}%)")
    print(f"  conditional pts/hand (divergent pairs) A-B: {cond:+.2f}")
    print(f"  unconditional marginal floor: {cond * rate:+.3f} pts/hand")


if __name__ == "__main__":
    main()
