#!/usr/bin/env python3
"""Production trump audit (Riley's cousins' screenshots, 2026-08-01).

Reads PRODUCTION Firestore (project rook13-01) via REST using the local
gcloud CLI token — strictly read-only. Replays every completed game's
action log through the parity-tested Python engine and records every
SELECT_TRUMP: declarer seat, which brain made it (human / heuristic /
browser gen / server style), the 13-card hand it held, trump length,
and whether a longer suit existed. Also pulls each flagged game's
'blunders' subcollection (family reports).

    ~/torch-env/bin/python scripts/prod_trump_audit.py --out runs/gen24/prod_audit.json
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rook.cards import (SUIT_NAMES, SEAT_NAMES, make_card, suit_of,  # noqa: E402
                        num_of)
from rook.engine import Game, BIDDING, WIDOW, REDEAL, PLAYING  # noqa: E402


def laydown_fastforward(g, claimant):
    """Port of service/brain/main.py laydown_fastforward (mirror of
    engine.ts LAYDOWN): claimant leads strongest-first, others follow with
    their lowest legal card."""
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

BASE = ("https://firestore.googleapis.com/v1/projects/rook13-01/"
        "databases/(default)/documents")
SUIT_IDX = {n: i for i, n in enumerate(SUIT_NAMES)}
SEAT_IDX = {n: i for i, n in enumerate(SEAT_NAMES)}

_TOKEN = {"v": None, "t": 0}


def token():
    if time.time() - _TOKEN["t"] > 2400:
        _TOKEN["v"] = subprocess.check_output(
            ["gcloud", "auth", "print-access-token"]).decode().strip()
        _TOKEN["t"] = time.time()
    return _TOKEN["v"]


def get(url):
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token()}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def unwrap(v):
    if "stringValue" in v:
        return v["stringValue"]
    if "integerValue" in v:
        return int(v["integerValue"])
    if "doubleValue" in v:
        return v["doubleValue"]
    if "booleanValue" in v:
        return v["booleanValue"]
    if "nullValue" in v:
        return None
    if "mapValue" in v:
        return {k: unwrap(x) for k, x in
                v["mapValue"].get("fields", {}).items()}
    if "arrayValue" in v:
        return [unwrap(x) for x in v["arrayValue"].get("values", [])]
    return None


def list_docs(path, page_size=300, mask=None):
    out = []
    tok = None
    while True:
        url = f"{BASE}/{path}?pageSize={page_size}"
        if mask:
            url += "".join(f"&mask.fieldPaths={m}" for m in mask)
        if tok:
            url += f"&pageToken={tok}"
        d = get(url)
        out.extend(d.get("documents", []))
        tok = d.get("nextPageToken")
        if not tok:
            return out


def card_int(c):
    return make_card(SUIT_IDX[c["suit"]], c["number"])


def audit_game(game_id):
    """Replay one game; return trump events + who made each choice."""
    docs = list_docs(f"games/{game_id}/actions", page_size=300)
    docs.sort(key=lambda d: d["name"])
    styles = {}          # seat -> botStyle or 'human'
    g = None
    events = []
    hand13 = None
    for doc in docs:
        f = {k: unwrap(v) for k, v in doc.get("fields", {}).items()}
        a = f.get("action") or {}
        t = a.get("type")
        try:
            if t == "SET_BOT":
                styles[SEAT_IDX[a["seat"]]] = a.get("botStyle", "?")
            elif t == "TAKE_SEAT":
                styles[SEAT_IDX[a["seat"]]] = "human"
            elif t == "START_GAME":
                g = Game(dealer=SEAT_IDX[a["dealerOverride"]]
                         if a.get("dealerOverride") else 0)
                # engine derives dealer from id hash in TS; the DEAL action
                # carries the deck, and bidding order comes from `dealer` in
                # the game doc — read it lazily below if needed
            elif t == "DEAL" and g is not None:
                deck = [card_int(c) for c in a["deck"]]
                g.deal(deck)
            elif t == "BID" and g is not None and g.phase == BIDDING:
                seat = SEAT_IDX[a["seat"]]
                bid = 0 if a["bid"] == "pass" else int(a["bid"])
                if not g.bid_history and g.turn != seat:
                    # infer the initial dealer from who speaks first:
                    # bidding always opens left of the dealer
                    g.dealer = (seat - 1) % 4
                    g.turn = seat
                g.bid(seat, bid)
            elif t == "SELECT_GODOWN" and g is not None:
                seat = SEAT_IDX[a["seat"]]
                hand13 = list(g.hands[seat])
                g.select_go_down(seat, [card_int(c) for c in a["cards"]])
            elif t == "SELECT_TRUMP" and g is not None:
                seat = SEAT_IDX[a["seat"]]
                trump = SUIT_IDX[a["suit"]]
                lens = {}
                for c in (hand13 or g.hands[seat]):
                    lens[suit_of(c)] = lens.get(suit_of(c), 0) + 1
                tlen = lens.get(trump, 0)
                events.append(dict(
                    hand=g.hand_number, seat=a["seat"],
                    style=styles.get(seat, "human"),
                    trump=SUIT_NAMES[trump], trump_len=tlen,
                    max_len=max(lens.values()),
                    bid=g.high_bid,
                    hand13=sorted(hand13 or [])))
                g.select_trump(seat, trump)
            elif t == "PLAY_CARD" and g is not None:
                g.play_card(SEAT_IDX[a["seat"]], card_int(a["card"]))
            elif t == "LAYDOWN" and g is not None:
                laydown_fastforward(g, SEAT_IDX[a["seat"]])
            elif t == "NEXT_HAND" and g is not None:
                g.next_hand()
            elif t == "FORFEIT":
                return events, None
            elif t == "REDEAL" and g is not None and g.phase == REDEAL:
                pass  # next DEAL action re-deals
        except Exception as e:
            return events, f"replay-stopped@{t}:{e}"
    return events, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="runs/gen24/prod_audit.json")
    ap.add_argument("--limit", type=int, default=0,
                    help="max games (0 = all)")
    args = ap.parse_args()
    games = list_docs("games", mask=["status"])
    print(f"{len(games)} game docs in production", flush=True)
    done = [d for d in games
            if unwrap(d["fields"].get("status", {})) == "completed"]
    print(f"{len(done)} completed", flush=True)
    if args.limit:
        done = done[:args.limit]
    all_events = []
    errors = 0
    flagged = []
    t0 = time.time()
    for i, d in enumerate(done, 1):
        gid = d["name"].split("/")[-1]
        try:
            evs, err = audit_game(gid)
        except Exception as e:
            errors += 1
            continue
        if err:
            errors += 1
        for e in evs:
            e["game"] = gid
        all_events.extend(evs)
        for e in evs:
            if e["trump_len"] < e["max_len"] or e["trump_len"] <= 3:
                flagged.append(e)
        if i % 25 == 0:
            print(f"  [{i}/{len(done)}] {len(all_events)} trump events, "
                  f"{len(flagged)} flagged, {errors} replay errors "
                  f"({(time.time() - t0) / i:.1f}s/game)", flush=True)
        time.sleep(0.05)

    import collections
    by_style = collections.defaultdict(lambda: collections.Counter())
    for e in all_events:
        key = "shorter!" if e["trump_len"] < e["max_len"] else \
            f"len{e['trump_len']}"
        by_style[e["style"]][key] += 1
    with open(args.out, "w") as f:
        json.dump(dict(events=all_events, flagged=flagged,
                       n_games=len(done), errors=errors), f)
    print(f"\nPRODUCTION TRUMP AUDIT — {len(done)} games, "
          f"{len(all_events)} contracts, {errors} replay errors:")
    for style, ctr in sorted(by_style.items()):
        tot = sum(ctr.values())
        sh = ctr.get("shorter!", 0)
        print(f"  {style:12s}: {tot:5d} contracts, "
              f"picked shorter-than-longest {sh} ({sh / tot:.1%})")
    print(f"flagged events: {len(flagged)} -> {args.out}")


if __name__ == "__main__":
    main()
