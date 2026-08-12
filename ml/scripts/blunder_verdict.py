#!/usr/bin/env python3
"""Judge every family blunder report with the Gen25-RC1 searcher.

For each report (games/{id}/blunders), replay the game to the flagged
decision and grade the flagged actor's ACTUAL choice against RC1's pick:
  play   — anytime searcher (budget-scaled), per-candidate world means
  godown/trump — MortalWidow's burial vs the flagged one, paired
           reflex-core playout of the true deal
Verdict currency: family points, negative = the flagged move really was
worse than RC1's line.

    ~/torch-env/bin/python scripts/blunder_verdict.py \
        --out runs/prodgames/blunder_verdicts.jsonl --workers 4
"""

import argparse
import json
import os
import sys
import time
from multiprocessing import Process

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import torch

from rook.cards import SUIT_NAMES, SEAT_NAMES, make_card, team_of
from rook.engine import Game, BIDDING

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prod_grade import (card_int, laydown_fastforward, _Env, price_widow,
                        seat_identity, SUIT_IDX, SEAT_IDX)


def find_and_grade(rec, reports, agent, mw, net, out_f):
    from alpharook.encoder import D_PLAY
    from alpharook.anytime import CAND_CAP

    gid = rec["id"]
    ident = seat_identity(rec["doc"])
    # index reports by (hand, kind, seat[, trick, card])
    want = []
    for rep in reports:
        t = rep["target"]
        seat = SEAT_IDX.get(t.get("seat"))
        if seat is None:
            continue
        want.append((rep, t, seat))
    g = None
    pending_widow = {}
    for f in rec["actions"]:
        a = f.get("action") or {}
        ty = a.get("type")
        try:
            if ty == "START_GAME":
                g = Game(dealer=0)
            elif ty == "DEAL" and g is not None:
                g.deal([card_int(c) for c in a["deck"]])
            elif ty == "BID" and g is not None and g.phase == BIDDING:
                seat = SEAT_IDX[a["seat"]]
                bid = 0 if a["bid"] == "pass" else int(a["bid"])
                if not g.bid_history and g.turn != seat:
                    g.dealer = (seat - 1) % 4
                    g.turn = seat
                g.bid(seat, bid)
            elif ty == "SELECT_GODOWN" and g is not None:
                seat = SEAT_IDX[a["seat"]]
                picks = [card_int(c) for c in a["cards"]]
                for rep, t, ts in want:
                    if (t["kind"] == "godown" and ts == seat
                            and rep["handNumber"] == g.hand_number):
                        pending_widow[seat] = (rep, g.clone(),
                                               sorted(picks))
                g.select_go_down(seat, picks)
            elif ty == "SELECT_TRUMP" and g is not None:
                seat = SEAT_IDX[a["seat"]]
                trump = SUIT_IDX[a["suit"]]
                hit = pending_widow.pop(seat, None)
                trump_rep = next(
                    (rep for rep, t, ts in want
                     if t["kind"] == "trump" and ts == seat
                     and rep["handNumber"] == g.hand_number), None)
                if hit or trump_rep:
                    rep = hit[0] if hit else trump_rep
                    gw = hit[1] if hit else None
                    if gw is None:
                        gw = g.clone()   # trump-only report: pre-trump state
                        hdisc = None
                    else:
                        hdisc = hit[2]
                    t0 = time.time()
                    # widow state for search = before go_down: only have
                    # it for godown reports; trump-only graded vs bot
                    # trump under same burial
                    if hdisc is not None:
                        env = _Env(gw)
                        bdisc, btrump = mw._widow_search(env, seat)
                        hA, hB = price_widow(gw, seat, hdisc, trump, net)
                        bA, bB = price_widow(gw, seat, sorted(bdisc),
                                             btrump, net)
                        tm = team_of(seat)
                        d = ((hA, hB)[tm] - (hA, hB)[1 - tm]) - \
                            ((bA, bB)[tm] - (bA, bB)[1 - tm])
                        out_f.write(json.dumps(dict(
                            game=gid, kind="godown",
                            reporter=rep["reporter"]["name"],
                            actor=rep.get("seatName"),
                            hand=rep["handNumber"], reason=rep.get(
                                "reason", ""),
                            flagged_disc=hdisc, flagged_trump=trump,
                            rc1_disc=sorted(bdisc), rc1_trump=btrump,
                            delta=float(d),
                            secs=round(time.time() - t0, 1))) + "\n")
                        out_f.flush()
                g.select_trump(seat, trump)
            elif ty == "PLAY_CARD" and g is not None:
                seat = SEAT_IDX[a["seat"]]
                card = card_int(a["card"])
                for rep, t, ts in want:
                    if (t["kind"] == "play" and ts == seat
                            and rep["handNumber"] == g.hand_number
                            and t.get("trick") == len(g.completed_tricks)
                            and card_int(t["card"]) == card):
                        legal = list(g.legal_cards(seat))
                        if len(legal) < 2:
                            break
                        t0 = time.time()
                        env = _Env(g)
                        _, qmap = agent._reflex_q(env, seat, D_PLAY,
                                                  legal)
                        use = list(legal)
                        if len(use) > CAND_CAP:
                            use = sorted(use, key=lambda c: qmap[c],
                                         reverse=True)[:CAND_CAP]
                            if card not in use:
                                use.append(card)
                        deadline = time.time() + agent._budget(
                            len(g.completed_tricks),
                            len(g.trick_plays) == 0)
                        pick, k, ke, tos, stop, means = agent._think(
                            env, seat, use, qmap, deadline=deadline)
                        delta = (means.get(card, 0.0)
                                 - means.get(pick, 0.0)) if means else None
                        out_f.write(json.dumps(dict(
                            game=gid, kind="play",
                            reporter=rep["reporter"]["name"],
                            actor=rep.get("seatName"),
                            actor_style=ident.get(seat, ("?", "?"))[1],
                            hand=rep["handNumber"],
                            trick=t.get("trick"),
                            reason=rep.get("reason", ""),
                            flagged_card=card, rc1_pick=pick,
                            delta=delta, k=k, stop=stop,
                            means={str(c): round(v, 2)
                                   for c, v in means.items()},
                            secs=round(time.time() - t0, 1))) + "\n")
                        out_f.flush()
                        break
                g.play_card(seat, card)
            elif ty == "LAYDOWN" and g is not None:
                laydown_fastforward(g, SEAT_IDX[a["seat"]])
            elif ty == "NEXT_HAND" and g is not None:
                g.next_hand()
            elif ty == "FORFEIT":
                return
        except Exception as e:
            out_f.write(json.dumps(dict(
                game=gid, kind="ERROR", err=f"{ty}:{e}")) + "\n")
            out_f.flush()
            return


def worker(wid, items, args):
    torch.set_num_threads(1)
    from alpharook.model import load_qnet
    from alpharook.beliefs import BeliefOracle
    from alpharook.anytime import AnytimeRookAgent
    from alpharook.mortalwidow import MortalWidowAgent
    net = load_qnet(args.net)
    net.eval()
    belief = BeliefOracle(args.belief, temp=0.5)
    agent = AnytimeRookAgent(net, belief, seed=4242,
                             budget_scale=args.budget_scale)
    mw = MortalWidowAgent(net, belief, budget_s=args.widow_budget,
                          k_min=8, seed=4242)
    out_f = open(f"{args.out}.w{wid}", "a")
    for rec, reports in items:
        find_and_grade(rec, reports, agent, mw, net, out_f)
        print(f"[w{wid}] {rec['id']}: {len(reports)} reports done",
              flush=True)
    out_f.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="runs/prodgames/games.jsonl")
    ap.add_argument("--out",
                    default="runs/prodgames/blunder_verdicts.jsonl")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--net", default="models/gen21-cand1.pt")
    ap.add_argument("--belief", default="models/gen15.pt")
    ap.add_argument("--widow-budget", type=float, default=8.0)
    ap.add_argument("--budget-scale", type=float, default=0.5)
    args = ap.parse_args()

    items = []
    for line in open(args.src):
        rec = json.loads(line)
        if rec["blunders"]:
            items.append((rec, rec["blunders"]))
    print(f"{len(items)} games with blunder reports "
          f"({sum(len(b) for _, b in items)} reports)", flush=True)
    shards = [items[i:: args.workers] for i in range(args.workers)]
    procs = [Process(target=worker, args=(i, shards[i], args))
             for i in range(args.workers) if shards[i]]
    for p in procs:
        p.start()
    for p in procs:
        p.join()
    print("done", flush=True)


if __name__ == "__main__":
    main()
