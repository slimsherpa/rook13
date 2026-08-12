#!/usr/bin/env python3
"""Confirm pass for beat-the-bot candidates (winner's-curse guard).

Takes the graded rows with delta > threshold, re-derives each decision
at replay_k=96 (+ standard confirm), and re-prices the human card vs
RC1's pick on that deeper, fresh evidence.

    ~/torch-env/bin/python scripts/confirm_beats.py --thresh 5 \
        --out runs/prodgames/confirms.jsonl
"""

import argparse
import glob
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import torch

from rook.engine import Game, BIDDING
from rook.cards import SEAT_NAMES

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prod_grade import (card_int, laydown_fastforward, _Env,
                        seat_identity, SUIT_IDX, SEAT_IDX)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--thresh", type=float, default=5.0)
    ap.add_argument("--k", type=int, default=96)
    ap.add_argument("--out", default="runs/prodgames/confirms.jsonl")
    ap.add_argument("--net", default="models/gen21-cand1.pt")
    ap.add_argument("--belief", default="models/gen15.pt")
    args = ap.parse_args()

    want = {}          # game -> {ai: row}
    for p in glob.glob("runs/prodgames/grades.jsonl.w*"):
        for line in open(p):
            r = json.loads(line)
            if (r["type"] == "PLAY" and r.get("delta") is not None
                    and r["delta"] > args.thresh):
                want.setdefault(r["game"], {})[r["ai"]] = r
    n_rows = sum(len(v) for v in want.values())
    print(f"{n_rows} candidate beats in {len(want)} games", flush=True)

    torch.set_num_threads(4)
    from alpharook.model import load_qnet
    from alpharook.beliefs import BeliefOracle
    from alpharook.anytime import AnytimeRookAgent, CAND_CAP
    from alpharook.encoder import D_PLAY
    net = load_qnet(args.net)
    net.eval()
    belief = BeliefOracle(args.belief, temp=0.5)
    agent = AnytimeRookAgent(net, belief, seed=4242)

    out_f = open(args.out, "a")
    done = set()
    if os.path.exists(args.out):
        pass
    for line in open("runs/prodgames/games.jsonl"):
        rec = json.loads(line)
        if rec["id"] not in want:
            continue
        marks = want[rec["id"]]
        g = None
        for ai, f in enumerate(rec["actions"]):
            a = f.get("action") or {}
            t = a.get("type")
            try:
                if t == "START_GAME":
                    g = Game(dealer=0)
                elif t == "DEAL" and g is not None:
                    g.deal([card_int(c) for c in a["deck"]])
                elif t == "BID" and g is not None and g.phase == BIDDING:
                    seat = SEAT_IDX[a["seat"]]
                    bid = 0 if a["bid"] == "pass" else int(a["bid"])
                    if not g.bid_history and g.turn != seat:
                        g.dealer = (seat - 1) % 4
                        g.turn = seat
                    g.bid(seat, bid)
                elif t == "SELECT_GODOWN" and g is not None:
                    g.select_go_down(SEAT_IDX[a["seat"]],
                                     [card_int(c) for c in a["cards"]])
                elif t == "SELECT_TRUMP" and g is not None:
                    g.select_trump(SEAT_IDX[a["seat"]],
                                   SUIT_IDX[a["suit"]])
                elif t == "PLAY_CARD" and g is not None:
                    seat = SEAT_IDX[a["seat"]]
                    card = card_int(a["card"])
                    if ai in marks:
                        row = marks[ai]
                        t0 = time.time()
                        legal = list(g.legal_cards(seat))
                        env = _Env(g)
                        _, qmap = agent._reflex_q(env, seat, D_PLAY,
                                                  legal)
                        use = list(legal)
                        if len(use) > CAND_CAP:
                            use = sorted(use, key=lambda c: qmap[c],
                                         reverse=True)[:CAND_CAP]
                            if card not in use:
                                use.append(card)
                        pick, k, ke, tos, stop, means = agent._think(
                            env, seat, use, qmap,
                            deadline=float("inf"), replay_k=args.k)
                        d96 = (means.get(card, 0.0)
                               - means.get(pick, 0.0)) if means else None
                        out_f.write(json.dumps(dict(
                            game=rec["id"], ai=ai, who=row["who"],
                            hand=row["hand"], trick=row["trick"],
                            chose=card, bot_pick=pick,
                            delta12=row["delta"],
                            delta96=d96, k=k,
                            secs=round(time.time() - t0, 1))) + "\n")
                        out_f.flush()
                    g.play_card(seat, card)
                elif t == "LAYDOWN" and g is not None:
                    laydown_fastforward(g, SEAT_IDX[a["seat"]])
                elif t == "NEXT_HAND" and g is not None:
                    g.next_hand()
                elif t == "FORFEIT":
                    break
            except Exception as e:
                print(f"  {rec['id']}@{ai}: {t}:{e}", flush=True)
                break
    out_f.close()
    print("confirm pass done", flush=True)


if __name__ == "__main__":
    main()
