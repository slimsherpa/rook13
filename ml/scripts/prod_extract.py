#!/usr/bin/env python3
"""Replay the downloaded production corpus; extract decisions + outcomes.

Input: runs/prodgames/games.jsonl (from prod_download.py).
Outputs:
  runs/prodgames/hands.jsonl     — one line per completed hand
  runs/prodgames/decisions.jsonl — one line per decision (all seats),
                                   with action index so the grading pass
                                   can rebuild the exact state
  runs/prodgames/blunders.jsonl  — flattened blunder reports
  runs/prodgames/players.json    — human name -> games/hands/seat counts

    ~/torch-env/bin/python scripts/prod_extract.py
"""

import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rook.cards import (SUIT_NAMES, SEAT_NAMES, make_card, suit_of, num_of,
                        CARD_POINTS, team_of)
from rook.engine import Game, BIDDING, WIDOW, REDEAL, PLAYING

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
            ordered = sorted(groups.items(), key=group_key)
            card = ordered[0][1][0]
        else:
            card = min(g.legal_cards(turn),
                       key=lambda c: (num_of(c), suit_of(c)))
        g.play_card(turn, card)


def seat_identity(gdoc):
    """seat index -> ('human', name) | ('bot', style) | ('empty', None)."""
    out = {}
    seats = gdoc.get("seats") or {}
    for sname, info in seats.items():
        if not info:
            continue
        idx = SEAT_IDX.get(sname)
        if idx is None:
            continue
        if info.get("kind") == "human":
            out[idx] = ("human", info.get("name") or info.get("uid"))
        elif info.get("kind") == "bot":
            out[idx] = ("bot", info.get("botStyle") or "?")
    return out


def replay_game(rec, hands_f, dec_f):
    gid = rec["id"]
    ident = seat_identity(rec["doc"])
    g = None
    hand13 = None            # buyer's 13 cards after widow pickup
    n_dec = 0
    laydown_from = None      # trick index laydown started, per hand
    for ai, f in enumerate(rec["actions"]):
        a = f.get("action") or {}
        t = a.get("type")
        try:
            if t == "START_GAME":
                g = Game(dealer=0)
            elif t == "DEAL" and g is not None:
                deck = [card_int(c) for c in a["deck"]]
                g.deal(deck)
                laydown_from = None
            elif t == "BID" and g is not None and g.phase == BIDDING:
                seat = SEAT_IDX[a["seat"]]
                bid = 0 if a["bid"] == "pass" else int(a["bid"])
                if not g.bid_history and g.turn != seat:
                    g.dealer = (seat - 1) % 4
                    g.turn = seat
                dec_f.write(json.dumps(dict(
                    game=gid, ai=ai, hand=g.hand_number, seat=seat,
                    who=ident.get(seat, ("?", "?")), type="BID",
                    high=g.high_bid, nbids=len(g.bid_history),
                    chose=bid, hand9=sorted(g.hands[seat]),
                    scores=list(g.scores))) + "\n")
                n_dec += 1
                g.bid(seat, bid)
            elif t == "SELECT_GODOWN" and g is not None:
                seat = SEAT_IDX[a["seat"]]
                hand13 = list(g.hands[seat])
                picks = [card_int(c) for c in a["cards"]]
                dec_f.write(json.dumps(dict(
                    game=gid, ai=ai, hand=g.hand_number, seat=seat,
                    who=ident.get(seat, ("?", "?")), type="GODOWN",
                    bid=g.high_bid, hand13=sorted(hand13),
                    chose=sorted(picks),
                    scores=list(g.scores))) + "\n")
                n_dec += 1
                g.select_go_down(seat, picks)
            elif t == "SELECT_TRUMP" and g is not None:
                seat = SEAT_IDX[a["seat"]]
                trump = SUIT_IDX[a["suit"]]
                dec_f.write(json.dumps(dict(
                    game=gid, ai=ai, hand=g.hand_number, seat=seat,
                    who=ident.get(seat, ("?", "?")), type="TRUMP",
                    bid=g.high_bid, hand13=sorted(hand13 or []),
                    chose=trump)) + "\n")
                n_dec += 1
                g.select_trump(seat, trump)
            elif t == "PLAY_CARD" and g is not None:
                seat = SEAT_IDX[a["seat"]]
                card = card_int(a["card"])
                legal = list(g.legal_cards(seat))
                dec_f.write(json.dumps(dict(
                    game=gid, ai=ai, hand=g.hand_number, seat=seat,
                    who=ident.get(seat, ("?", "?")), type="PLAY",
                    trick=len(g.completed_tricks),
                    pos=len(g.trick_plays),
                    ncand=len(legal), legal=sorted(legal),
                    chose=card, trump=g.trump,
                    buyer=g.bid_winner, bid=g.high_bid)) + "\n")
                n_dec += 1
                g.play_card(seat, card)
            elif t == "LAYDOWN" and g is not None:
                laydown_from = len(g.completed_tricks)
                laydown_fastforward(g, SEAT_IDX[a["seat"]])
            elif t == "NEXT_HAND" and g is not None:
                if g.hand_history:
                    h = g.hand_history[-1]
                    hands_f.write(json.dumps(dict(
                        game=gid, hand=h[0], buyer=h[1], bid=h[2],
                        trump=h[3], ptsA=h[4], ptsB=h[5], set=bool(h[6]),
                        laydown_from=laydown_from,
                        buyer_who=ident.get(h[1], ("?", "?")),
                        scores=list(g.scores))) + "\n")
                g.next_hand()
            elif t == "FORFEIT":
                return n_dec, "forfeit"
        except Exception as e:
            return n_dec, f"replay-stopped@{ai}:{t}:{e}"
    # last hand of a completed game has no NEXT_HAND after it
    if g is not None and g.hand_history:
        h = g.hand_history[-1]
        hands_f.write(json.dumps(dict(
            game=gid, hand=h[0], buyer=h[1], bid=h[2],
            trump=h[3], ptsA=h[4], ptsB=h[5], set=bool(h[6]),
            laydown_from=laydown_from,
            buyer_who=ident.get(h[1], ("?", "?")),
            scores=list(g.scores), last=True)) + "\n")
    return n_dec, None


def main():
    src = "runs/prodgames/games.jsonl"
    hands_f = open("runs/prodgames/hands.jsonl", "w")
    dec_f = open("runs/prodgames/decisions.jsonl", "w")
    bl_f = open("runs/prodgames/blunders.jsonl", "w")
    players = defaultdict(lambda: dict(games=0, seats=defaultdict(int)))
    n_games = n_err = 0
    for line in open(src):
        rec = json.loads(line)
        ident = seat_identity(rec["doc"])
        for idx, (kind, name) in ident.items():
            if kind == "human":
                players[name]["games"] += 1
                players[name]["seats"][SEAT_NAMES[idx]] += 1
        for b in rec["blunders"]:
            b["game"] = rec["id"]
            bl_f.write(json.dumps(b) + "\n")
        n_dec, err = replay_game(rec, hands_f, dec_f)
        n_games += 1
        if err and err != "forfeit":
            n_err += 1
            if n_err <= 5:
                print(f"  {rec['id']}: {err}", flush=True)
    for p in players.values():
        p["seats"] = dict(p["seats"])
    json.dump(players, open("runs/prodgames/players.json", "w"), indent=1)
    print(f"{n_games} games, {n_err} replay errors", flush=True)
    print(json.dumps({k: v["games"] for k, v in sorted(
        players.items(), key=lambda kv: -kv[1]['games'])}, indent=1))


if __name__ == "__main__":
    main()
