"""Golden-trace parity: the Python engine + bots must reproduce the TS
engine + bots exactly, across complete games.

Fixtures come from the real TS engine:
  GEN_TRACES=1 npx vitest run src/lib/alpharook/traces.gen.test.ts

For every action in every trace we check two things:
  1. Bot parity — before applying a logged decision (bid/go-down/trump/play),
     ask the Python bot for its decision; it must match the TS bot's.
  2. Engine parity — after applying the action, the state snapshot (phase,
     turn, scores, points, tricks, auction) must match the TS engine's.
"""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rook.cards import PASS  # noqa: E402
from rook.engine import Game, PHASE_NAMES, BIDDING, WIDOW, TRUMP, PLAYING  # noqa: E402
from rook.bots import next_bot_action  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "traces.json"
SEAT_IDX = {"A1": 0, "B1": 1, "A2": 2, "B2": 3}
TEAM_IDX = {"A": 0, "B": 1}
PHASE_IDX = {name: i for i, name in enumerate(PHASE_NAMES)}
DECIDED = (BIDDING, WIDOW, TRUMP, PLAYING)


def load_games():
    if not FIXTURE.exists():
        pytest.skip("run GEN_TRACES=1 npx vitest run src/lib/alpharook/traces.gen.test.ts first")
    with open(FIXTURE) as f:
        return json.load(f)["games"]


def norm_bid(b):
    return PASS if b == "pass" else b


@pytest.mark.parametrize("gi", range(24))
def test_game_parity(gi):
    games = load_games()
    if gi >= len(games):
        pytest.skip("fewer games in fixture")
    game = games[gi]
    styles = game["styles"]
    g = Game(dealer=SEAT_IDX[game["dealer"]])

    for ai, (action, snap) in enumerate(zip(game["actions"], game["snaps"])):
        where = f"game {gi} action {ai} ({action['t']}) in {PHASE_NAMES[g.phase]}"

        # 1) bot parity on decision phases
        if g.phase in DECIDED:
            kind, seat, payload = next_bot_action(g, styles)
            if action["t"] == "BID":
                assert kind == "BID" and seat == SEAT_IDX[action["seat"]], where
                assert payload == norm_bid(action["bid"]), where
            elif action["t"] == "GODOWN":
                assert kind == "GODOWN" and seat == SEAT_IDX[action["seat"]], where
                assert sorted(payload) == sorted(action["cards"]), where
            elif action["t"] == "TRUMP":
                assert kind == "TRUMP" and seat == SEAT_IDX[action["seat"]], where
                assert payload == action["suit"], where
            elif action["t"] == "PLAY":
                assert kind == "PLAY" and seat == SEAT_IDX[action["seat"]], where
                assert payload == action["card"], where

        # 2) apply the logged action
        t = action["t"]
        if t in ("DEAL", "ACK_REDEAL"):
            g.deal(action["deck"])
        elif t == "BID":
            g.bid(SEAT_IDX[action["seat"]], norm_bid(action["bid"]))
        elif t == "GODOWN":
            g.select_go_down(SEAT_IDX[action["seat"]], action["cards"])
        elif t == "TRUMP":
            g.select_trump(SEAT_IDX[action["seat"]], action["suit"])
        elif t == "PLAY":
            g.play_card(SEAT_IDX[action["seat"]], action["card"])
        elif t == "NEXT":
            g.next_hand()
        else:
            raise AssertionError(f"unknown action {t}")

        # 3) engine parity via snapshot
        assert PHASE_NAMES[g.phase] == snap["p"], where
        expect_turn = None if snap["t"] is None else SEAT_IDX[snap["t"]]
        assert g.turn == expect_turn, where
        assert g.scores == [snap["sA"], snap["sB"]], where
        assert g.points_taken == [snap["pA"], snap["pB"]], where
        assert g.tricks_won == [snap["twA"], snap["twB"]], where
        assert g.high_bid == snap["hb"], where
        expect_bw = None if snap["bw"] is None else SEAT_IDX[snap["bw"]]
        assert g.bid_winner == expect_bw, where
        assert g.trump == snap["tr"], where

    final = game["final"]
    assert g.scores == [final["scores"]["A"], final["scores"]["B"]]
    expect_winner = None if final["winner"] is None else TEAM_IDX[final["winner"]]
    assert g.winner == expect_winner
    assert len(g.hand_history) == final["hands"]
