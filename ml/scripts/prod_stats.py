#!/usr/bin/env python3
"""Style profiles from the full production corpus (no nets, no solving).

Reads runs/prodgames/{games,hands,decisions,blunders}.jsonl and emits
runs/prodgames/stats.json — per-player bidding, widow, trump, lead,
laydown, and outcome profiles, plus blunder-report rollups.

    ~/torch-env/bin/python scripts/prod_stats.py
"""

import json
import sys
import os
from collections import Counter, defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rook.cards import CARD_POINTS, SEAT_NAMES

TRIO = ("Nate Girsberger", "Tyler Girsberger", "Carson Gardner")
MIN_GAMES = 20      # profile every human with at least this many games


def suit_of(c):
    return c // 10


def num_of(c):
    return c % 10 + 5


def dominance_violations(godown, hand13):
    """Buried non-counters with a kept strictly-lower same-suit
    non-counter (the bug Riley's grading found seven times over)."""
    buried = set(godown)
    kept = [c for c in hand13 if c not in buried]
    n = 0
    for b in buried:
        if CARD_POINTS[b]:
            continue
        if any(k for k in kept
               if k // 10 == b // 10 and k < b and not CARD_POINTS[k]):
            n += 1
    return n


def main():
    # ---- game docs: identity, winners, partners ----------------------
    seat_team = {0: "A", 1: "B", 2: "A", 3: "B"}
    P = defaultdict(lambda: dict(
        games=0, wins=0, losses=0, partner_bots=Counter(),
        games_vs=Counter(), hands=0,
        bids_made=0, passes=0, bought=0, bought_bid=Counter(),
        made=0, went_set=0, buyer_pts=0.0, buyer_hands=0,
        def_hands=0, def_sets=0,
        trump_len=Counter(), trump_not_max=0, trump_picks=0,
        buried_counter_pts=0.0, dom_viol=0, godowns=0,
        leads=0, lead_boss14=0, lead_trump=0, lead_counter=0,
        lead_boss14_have=0, leads_with_boss=0,
        buyer_leads=0, defender_leads=0,
        laydowns=0)
    )
    game_meta = {}
    for line in open("runs/prodgames/games.jsonl"):
        r = json.loads(line)
        d = r["doc"]
        seats = d.get("seats") or {}
        ident = {}
        for sname, info in seats.items():
            if info and sname in SEAT_NAMES:
                idx = SEAT_NAMES.index(sname)
                ident[idx] = ((info.get("kind"), info.get("name")
                               if info.get("kind") == "human"
                               else info.get("botStyle")))
        game_meta[r["id"]] = dict(winner=d.get("winner"), ident=ident,
                                  created=d.get("createdAt"))
        for idx, (kind, name) in ident.items():
            if kind != "human":
                continue
            p = P[name]
            p["games"] += 1
            my_team = seat_team[idx]
            if d.get("winner") == my_team:
                p["wins"] += 1
            elif d.get("winner"):
                p["losses"] += 1
            partner = ident.get((idx + 2) % 4)
            if partner:
                p["partner_bots"][f"{partner[0]}:{partner[1]}"] += 1

    # ---- hands: buyer outcomes ---------------------------------------
    for line in open("runs/prodgames/hands.jsonl"):
        h = json.loads(line)
        kind, name = h["buyer_who"]
        meta = game_meta.get(h["game"])
        if kind == "human":
            p = P[name]
            p["buyer_hands"] += 1
            p["bought_bid"][h["bid"]] += 1
            my = "AB"[h["buyer"] % 2]
            pts = h["ptsA"] if my == "A" else h["ptsB"]
            p["buyer_pts"] += pts
            if h["set"]:
                p["went_set"] += 1
            else:
                p["made"] += 1
        # defender bookkeeping for humans on the other team
        if meta:
            buyer_team = "AB"[h["buyer"] % 2]
            for idx, (k, n) in meta["ident"].items():
                if k == "human" and seat_team[idx] != buyer_team:
                    P[n]["def_hands"] += 1
                    if h["set"]:
                        P[n]["def_sets"] += 1

    # ---- decisions: bids, widow, trump, leads ------------------------
    for line in open("runs/prodgames/decisions.jsonl"):
        r = json.loads(line)
        kind, name = r["who"]
        if kind != "human":
            continue
        p = P[name]
        t = r["type"]
        if t == "BID":
            if r["chose"] == 0:
                p["passes"] += 1
            else:
                p["bids_made"] += 1
        elif t == "GODOWN":
            p["godowns"] += 1
            p["buried_counter_pts"] += sum(CARD_POINTS[c]
                                           for c in r["chose"])
            p["dom_viol"] += dominance_violations(r["chose"], r["hand13"])
        elif t == "TRUMP":
            p["trump_picks"] += 1
            lens = Counter(suit_of(c) for c in r["hand13"])
            tl = lens.get(r["chose"], 0)
            p["trump_len"][tl] += 1
            if tl < max(lens.values()):
                p["trump_not_max"] += 1
        elif t == "PLAY" and r["pos"] == 0 and r["trick"] == 0:
            p["leads"] += 1
            c = r["chose"]
            trump = r["trump"]
            if r["buyer"] is not None:
                if r["seat"] % 2 == r["buyer"] % 2:
                    p["buyer_leads"] += 1
                else:
                    p["defender_leads"] += 1
            if suit_of(c) == trump:
                p["lead_trump"] += 1
            if CARD_POINTS[c]:
                p["lead_counter"] += 1
            bosses = [x for x in r["legal"]
                      if num_of(x) == 14 and suit_of(x) != trump]
            if bosses:
                p["leads_with_boss"] += 1
                if c in bosses:
                    p["lead_boss14_have"] += 1
            if num_of(c) == 14 and suit_of(c) != trump:
                p["lead_boss14"] += 1

    # ---- laydowns (from raw games: count LAYDOWN by seat) ------------
    for line in open("runs/prodgames/games.jsonl"):
        r = json.loads(line)
        meta = game_meta[r["id"]]
        for f in r["actions"]:
            a = f.get("action") or {}
            if a.get("type") == "LAYDOWN":
                idx = SEAT_NAMES.index(a["seat"])
                who = meta["ident"].get(idx)
                if who and who[0] == "human":
                    P[who[1]]["laydowns"] += 1

    # ---- blunders ----------------------------------------------------
    blunders = dict(by_reporter=Counter(), on_bots=0, on_humans=0,
                    kinds=Counter(), reports=[])
    for line in open("runs/prodgames/blunders.jsonl"):
        b = json.loads(line)
        blunders["by_reporter"][b["reporter"]["name"]] += 1
        blunders["on_bots" if b.get("seatIsBot") else "on_humans"] += 1
        blunders["kinds"][b.get("target", {}).get("kind", "?")] += 1
        blunders["reports"].append(dict(
            reporter=b["reporter"]["name"], seat=b.get("seatName"),
            bot=b.get("seatIsBot"), kind=b.get("target", {}).get("kind"),
            hand=b.get("handNumber"), reason=b.get("reason", ""),
            game=b.get("game")))

    out = {}
    for name, p in P.items():
        if p["games"] < MIN_GAMES and name not in TRIO:
            continue
        for k in ("partner_bots", "bought_bid", "trump_len"):
            p[k] = dict(p[k])
        out[name] = p
    json.dump(dict(players=out, blunders={
        "by_reporter": dict(blunders["by_reporter"]),
        "on_bots": blunders["on_bots"],
        "on_humans": blunders["on_humans"],
        "kinds": dict(blunders["kinds"]),
        "reports": blunders["reports"],
    }), open("runs/prodgames/stats.json", "w"), indent=1)

    for name in sorted(out, key=lambda n: -out[n]["games"]):
        p = out[name]
        gw = p["wins"] / max(1, p["wins"] + p["losses"])
        made = p["made"] / max(1, p["buyer_hands"])
        print(f"{name:22s} g={p['games']:3d} win%={gw:.0%} "
              f"bought={p['buyer_hands']:4d} made%={made:.0%} "
              f"defsets%={p['def_sets']/max(1,p['def_hands']):.0%} "
              f"boss14lead={p['lead_boss14_have']}/{p['leads_with_boss']} "
              f"domviol={p['dom_viol']}")


if __name__ == "__main__":
    main()
