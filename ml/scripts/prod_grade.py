#!/usr/bin/env python3
"""Grade production human decisions with the Gen25-RC1 stack at K48.

For every card play by a target human: rebuild the exact state, run the
anytime searcher's deterministic replay path (replay_k=48 selection
worlds + the standard fresh-world confirm), and bank the per-candidate
family-point means, RC1's pick, and the human's EV delta.

For every widow (go-down + trump) by a target human: run MortalWidow
(budgeted) for RC1's burial, then price human-vs-RC1 with a paired
counterfactual playout of the true deal (reflex core on all seats,
identical machinery to widowtwin.twin).

    ~/torch-env/bin/python scripts/prod_grade.py \
        --players "Tyler Girsberger,Carson Gardner,Nathan Steele" \
        --workers 7 --out runs/prodgames/grades.jsonl

Resumable: (game, ai) pairs already in --out are skipped.
"""

import argparse
import json
import os
import sys
import time
from multiprocessing import Process

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import torch

from rook.cards import (SUIT_NAMES, SEAT_NAMES, make_card, suit_of, num_of,
                        team_of)
from rook.engine import Game, BIDDING, WIDOW, PLAYING

SUIT_IDX = {n: i for i, n in enumerate(SUIT_NAMES)}
SEAT_IDX = {n: i for i, n in enumerate(SEAT_NAMES)}


def card_int(c):
    return make_card(SUIT_IDX[c["suit"]], c["number"])


def laydown_fastforward(g, claimant):
    while g.phase == PLAYING:
        turn = g.turn
        if turn == claimant:
            hand = g.hands[turn]
            groups = {}
            for c in hand:
                groups.setdefault(suit_of(c), []).append(c)
            for cs in groups.values():
                cs.sort(key=num_of, reverse=True)

            def group_key(item):
                s, cs = item
                is_trump = 0 if (g.trump is not None and s == g.trump) else 1
                power = sum(num_of(c) for c in cs)
                return (is_trump, -len(cs), -power)
            card = sorted(groups.items(), key=group_key)[0][1][0]
        else:
            card = min(g.legal_cards(turn),
                       key=lambda c: (num_of(c), suit_of(c)))
        g.play_card(turn, card)


class _Env:
    """Duck-typed env for the searcher: .g, .picks, .trump_intent."""

    def __init__(self, g, picks=None, trump_intent=None):
        self.g = g
        self.picks = picks or []
        self.trump_intent = trump_intent


def play_out_reflex(g, net):
    """Finish the hand with the reflex net on every seat (deterministic)."""
    from alpharook.search import _Sim
    from alpharook.arena import model_choose
    sim = _Sim(g, [], None)
    while not sim.hand_over:
        s, dt, cs = sim.decision()
        sim.apply(cs[0] if len(cs) == 1 else
                  model_choose(net, "cpu", sim, s, dt, cs))
    h = g.hand_history[-1]
    return int(h[4]), int(h[5])


def price_widow(g_widow, seat, disc, trump, net):
    g = g_widow.clone()
    g.select_go_down(seat, list(disc))
    g.select_trump(seat, trump)
    return play_out_reflex(g, net)


def seat_identity(gdoc):
    out = {}
    for sname, info in (gdoc.get("seats") or {}).items():
        if not info or sname not in SEAT_IDX:
            continue
        idx = SEAT_IDX[sname]
        if info.get("kind") == "human":
            out[idx] = ("human", info.get("name") or info.get("uid"))
        elif info.get("kind") == "bot":
            out[idx] = ("bot", info.get("botStyle") or "?")
    return out


def grade_game(rec, targets, agent, mw, net, done, out_f, bot_styles=()):
    from alpharook.encoder import D_PLAY

    gid = rec["id"]
    ident = seat_identity(rec["doc"])
    target_seats = {i for i, (k, n) in ident.items()
                    if (k == "human" and n in targets)
                    or (k == "bot" and n in bot_styles)}
    if not target_seats:
        return 0
    g = None
    n = 0
    pending_widow = None       # (ai, seat, g_clone, hand13, human_disc)
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
                seat = SEAT_IDX[a["seat"]]
                picks = [card_int(c) for c in a["cards"]]
                if seat in target_seats and (gid, ai) not in done:
                    pending_widow = (ai, seat, g.clone(),
                                     sorted(g.hands[seat]), sorted(picks))
                g.select_go_down(seat, picks)
            elif t == "SELECT_TRUMP" and g is not None:
                seat = SEAT_IDX[a["seat"]]
                trump = SUIT_IDX[a["suit"]]
                if pending_widow and pending_widow[1] == seat:
                    wai, _, gw, hand13, hdisc = pending_widow
                    pending_widow = None
                    t0 = time.time()
                    env = _Env(gw)
                    bdisc, btrump = mw._widow_search(env, seat)
                    bdisc = sorted(bdisc)
                    row = dict(game=gid, ai=wai, hand=g.hand_number,
                               seat=seat, who=ident[seat][1], type="WIDOW",
                               bid=g.high_bid, hand13=hand13,
                               human_disc=hdisc, human_trump=trump,
                               bot_disc=bdisc, bot_trump=btrump)
                    if hdisc == bdisc and trump == btrump:
                        row["delta"] = 0.0
                    else:
                        hA, hB = price_widow(gw, seat, hdisc, trump, net)
                        bA, bB = price_widow(gw, seat, bdisc, btrump, net)
                        tm = team_of(seat)
                        h_my = (hA, hB)[tm] - (hA, hB)[1 - tm]
                        b_my = (bA, bB)[tm] - (bA, bB)[1 - tm]
                        row["delta"] = float(h_my - b_my)
                        row["human_pts"] = [hA, hB]
                        row["bot_pts"] = [bA, bB]
                    row["secs"] = round(time.time() - t0, 2)
                    out_f.write(json.dumps(row) + "\n")
                    out_f.flush()
                    n += 1
                g.select_trump(seat, trump)
            elif t == "PLAY_CARD" and g is not None:
                seat = SEAT_IDX[a["seat"]]
                card = card_int(a["card"])
                legal = list(g.legal_cards(seat))
                if (seat in target_seats and len(legal) > 1
                        and (gid, ai) not in done):
                    t0 = time.time()
                    env = _Env(g)
                    _, qmap = agent._reflex_q(env, seat, D_PLAY, legal)
                    use = list(legal)
                    from alpharook.anytime import CAND_CAP
                    if len(use) > CAND_CAP:
                        use = sorted(use, key=lambda c: qmap[c],
                                     reverse=True)[:CAND_CAP]
                        if card not in use:
                            use.append(card)
                    trick = len(g.completed_tricks)
                    is_lead = len(g.trick_plays) == 0
                    deadline = time.time() + agent._budget(trick, is_lead)
                    pick, k, ke, tos, stop, means = agent._think(
                        env, seat, use, qmap, deadline=deadline)
                    delta = (means.get(card, 0.0) - means.get(pick, 0.0)
                             if means else None)
                    out_f.write(json.dumps(dict(
                        game=gid, ai=ai, hand=g.hand_number, seat=seat,
                        who=ident[seat][1], type="PLAY",
                        trick=len(g.completed_tricks),
                        pos=len(g.trick_plays), trump=g.trump,
                        buyer=g.bid_winner, bid=g.high_bid,
                        my_team_buying=int(team_of(seat)
                                           == team_of(g.bid_winner)),
                        legal=sorted(legal), chose=card, bot_pick=pick,
                        delta=delta, stop=stop, k=k, ke=ke,
                        means={str(c): round(v, 2)
                               for c, v in means.items()},
                        secs=round(time.time() - t0, 2))) + "\n")
                    out_f.flush()
                    n += 1
                g.play_card(seat, card)
            elif t == "LAYDOWN" and g is not None:
                laydown_fastforward(g, SEAT_IDX[a["seat"]])
            elif t == "NEXT_HAND" and g is not None:
                g.next_hand()
            elif t == "FORFEIT":
                return n
        except Exception as e:
            out_f.write(json.dumps(dict(
                game=gid, ai=ai, type="ERROR", err=f"{t}:{e}")) + "\n")
            out_f.flush()
            return n
    return n


def worker(wid, games, targets, args):
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

    import glob as _glob
    out_path = f"{args.out}.w{wid}"
    done = set()
    for p in _glob.glob(f"{args.out}.w*"):
        for line in open(p):
            try:
                r = json.loads(line)
                done.add((r["game"], r["ai"]))
            except Exception:
                pass
    out_f = open(out_path, "a")
    bot_styles = tuple(s for s in (args.bot_styles or "").split(",") if s)
    for rec in games:
        n = grade_game(rec, targets, agent, mw, net, done, out_f,
                       bot_styles)
        print(f"[w{wid}] {rec['id']}: {n} graded", flush=True)
    out_f.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="runs/prodgames/games.jsonl")
    ap.add_argument("--out", default="runs/prodgames/grades.jsonl")
    ap.add_argument("--players", required=True)
    ap.add_argument("--workers", type=int, default=7)
    ap.add_argument("--net", default="models/gen21-cand1.pt")
    ap.add_argument("--belief", default="models/gen15.pt")
    ap.add_argument("--widow-budget", type=float, default=12.0)
    ap.add_argument("--budget-scale", type=float, default=0.25)
    ap.add_argument("--bot-styles", default="")
    ap.add_argument("--limit-games", type=int, default=0)
    args = ap.parse_args()
    targets = {p.strip() for p in args.players.split(",")}

    styles = {s for s in (args.bot_styles or "").split(",") if s}
    games = []
    for line in open(args.src):
        rec = json.loads(line)
        ident = seat_identity(rec["doc"])
        if (any(k == "human" and n in targets for k, n in ident.values())
                or any(k == "bot" and n in styles
                       for k, n in ident.values())):
            games.append(rec)
    if args.limit_games:
        games = games[: args.limit_games]
    print(f"{len(games)} games feature {sorted(targets)}", flush=True)

    shards = [games[i:: args.workers] for i in range(args.workers)]
    procs = [Process(target=worker, args=(i, shards[i], targets, args))
             for i in range(args.workers) if shards[i]]
    for p in procs:
        p.start()
    for p in procs:
        p.join()
    print("all workers done", flush=True)


if __name__ == "__main__":
    main()
