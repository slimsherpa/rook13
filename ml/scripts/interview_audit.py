"""Interview audit — replay a production game's bot decisions in the lab.

For every server-bot card play in a dumped action log (scratchpad
game_actions.json format: [{index, by, action}...]), reconstruct the
exact decision state, re-run the serving stack (anytime @0.25 + Gardner
shape), and answer Riley's questions:

  - how long did each decision think, and what was the max?
  - how many daydream worlds (k) did the clock allow?
  - was the depth needed — what is the SMALLEST k that reaches the same
    verdict? (replay(k) is bit-exact per k: state-derived seeds)

Style-spot leads (partner/defender) go through the Gardner layer live;
the k-sweep below prices the plain searcher pick — the style layer's own
mechanism is reported separately by its telemetry.

  ~/torch-env/bin/python scripts/interview_audit.py <actions.json> <gameId>
"""

from __future__ import annotations

import json
import sys
import time

sys.path.insert(0, ".")

from rook.cards import PASS  # noqa: E402
from rook.engine import Game, PLAYING  # noqa: E402

SEATS = ["A1", "B1", "A2", "B2"]
SUITS = ["Red", "Yellow", "Black", "Green"]
SEAT_IDX = {s: i for i, s in enumerate(SEATS)}


def card_int(c):
    return SUITS.index(c["suit"]) * 10 + (c["number"] - 5)


def first_dealer(game_id: str) -> int:
    h = 7
    for ch in game_id:
        h = ((h * 31 + ord(ch)) & 0xFFFFFFFF)
    return h % 4


def laydown_fastforward(g: Game, claimant: int) -> None:
    """Copy of service.brain.main.laydown_fastforward (engine.ts LAYDOWN)."""
    from rook.cards import suit_of, num_of
    while g.phase == PLAYING:
        turn = g.turn
        if turn == claimant:
            hand = g.hands[turn]
            groups: dict[int, list[int]] = {}
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


def replay_prefix(dealer: int, acts: list[dict]) -> Game:
    """Mirror of service.brain.main.replay, driver-encoded actions."""
    g = Game(dealer=dealer)
    for a in acts:
        t = a["type"]
        if t in ("DEAL", "ACK_REDEAL"):
            g.deal([card_int(c) for c in a["deck"]])
        elif t == "BID":
            g.bid(SEAT_IDX[a["seat"]],
                  PASS if a["bid"] == "pass" else a["bid"])
        elif t == "SELECT_GODOWN":
            g.select_go_down(SEAT_IDX[a["seat"]],
                             [card_int(c) for c in a["cards"]])
        elif t == "SELECT_TRUMP":
            g.select_trump(SEAT_IDX[a["seat"]], SUITS.index(a["suit"]))
        elif t == "PLAY_CARD":
            g.play_card(SEAT_IDX[a["seat"]], card_int(a["card"]))
        elif t == "NEXT_HAND":
            g.next_hand()
        elif t == "LAYDOWN":
            laydown_fastforward(g, SEAT_IDX[a["seat"]])
    return g


def main():
    path, game_id = sys.argv[1], sys.argv[2]
    rows = json.load(open(path))
    dealer = first_dealer(game_id)

    from alpharook.model import load_qnet
    from alpharook.beliefs import BeliefOracle
    from alpharook.anytime import AnytimeRookAgent
    from alpharook.gardner import GardnerAgent
    from alpharook.env import SelfPlayGame
    from alpharook.encoder import D_PLAY

    net = load_qnet("models/gen21-cand1.pt")
    belief = BeliefOracle("runs/gen15/best_duel.pt", temp=0.5)
    core = AnytimeRookAgent(net, belief, budget_scale=0.25, seed=0)
    agent = GardnerAgent(core, mode="shape", tau_style=4.0)

    out = []
    hand_no = 1
    for i, r in enumerate(rows):
        a = r["action"]
        if a["type"] == "NEXT_HAND":
            hand_no += 1
        if a["type"] != "PLAY_CARD" or r["by"] != "bot":
            continue
        seat = SEAT_IDX[a["seat"]]
        played = card_int(a["card"])
        g = replay_prefix(dealer, [x["action"] for x in rows[:i]])
        if g.phase != PLAYING or g.turn != seat:
            print(f"#{r['index']}: replay mismatch (phase {g.phase} turn {g.turn}), skip")
            continue
        cands = g.legal_cards(seat)
        if len(cands) <= 1:
            continue
        env = SelfPlayGame.__new__(SelfPlayGame)
        env.g = g
        env.picks = []
        env.trump_intent = None
        _s, dtype, c2 = env.decision()
        assert dtype == D_PLAY and _s == seat

        t0 = time.time()
        pick = agent.choose(env, seat, dtype, list(c2))
        secs = time.time() - t0
        think = agent.last_think or core.last_think or {}
        k = think.get("k", 0)
        ke = think.get("ke", 0)

        # k-sweep: smallest k whose bit-exact replay verdict matches the
        # full-budget pick (plain searcher; style layer noted separately)
        min_k = None
        if k > 1:
            for kk in [1, 2, 4, 8, 16, 32, 64, 128]:
                if kk >= k:
                    break
                if core.replay(env, seat, dtype, list(c2), kk) == pick:
                    min_k = kk
                    break
            if min_k is None:
                min_k = k
        else:
            min_k = k

        style = None
        stats = agent.style_stats
        if stats != getattr(main, "_last_stats", None):
            for key in ("merit", "tiebreak", "search_override", "def_swaps"):
                prev = getattr(main, "_prev", {}).get(key, 0)
                if stats.get(key, 0) > prev:
                    style = key
            main._prev = dict(stats)
        main._last_stats = dict(stats)

        out.append(dict(index=r["index"], hand=hand_no, seat=a["seat"],
                        trick=len(g.completed_tricks),
                        lead=int(not g.trick_plays),
                        played=played, repick=int(pick),
                        match=int(pick == played),
                        secs=round(secs, 2), k=k, ke=ke,
                        stop=think.get("stop"), min_k=min_k, style=style))
        print(json.dumps(out[-1]), flush=True)

    json.dump(out, open("runs/gardner/interview_audit.json", "w"), indent=1)
    n = len(out)
    match = sum(o["match"] for o in out)
    print(f"\n=== {n} decisions | repick match {match}/{n} "
          f"| max secs {max(o['secs'] for o in out):.1f} "
          f"| max k {max(o['k'] for o in out)}")
    ks = sorted(o["min_k"] for o in out)
    print(f"min-sufficient-k: p50 {ks[n // 2]}, p90 {ks[int(n * .9)]}, "
          f"max {ks[-1]} | k=1 suffices: {sum(1 for x in ks if x == 1)}/{n}")


if __name__ == "__main__":
    main()
