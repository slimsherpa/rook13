"""P1.4 interview audit: the service's anytime decisions replay
BIT-EXACTLY in the lab — the trump bug's law, enforced before launch.

The contract under test: for any production action log, the brain's
/decide with style=anytime returns a card plus think telemetry (k worlds,
state-derived seed), and a lab AnytimeRookAgent given the same log and
the same k derives the same card. Wall clocks may differ between lab and
service; k is the complete record of what the clock decided, everything
else is deterministic.

The service module is imported directly (no HTTP): same code path as the
container, minus the network.
"""

import os
import random
import sys
from pathlib import Path

import pytest

torch = pytest.importorskip("torch")
pytest.importorskip("fastapi")

# the brain must see the flag before get_agent builds the style
os.environ.setdefault("ANYTIME_ENABLED", "1")
os.environ.setdefault("ANYTIME_SCALE", "0.05")

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from service.brain.main import decide, DecideReq, SEAT_NAME  # noqa: E402

from rook.cards import PASS, create_deck                     # noqa: E402
from rook.engine import Game, BIDDING, WIDOW, TRUMP, PLAYING, HAND_DONE  # noqa: E402
from rook.bots import next_bot_action                        # noqa: E402
from alpharook.anytime import AnytimeRookAgent, decision_seed  # noqa: E402
from alpharook.beliefs import BeliefOracle                   # noqa: E402
from alpharook.encoder import D_PLAY                         # noqa: E402
from alpharook.env import SelfPlayGame                       # noqa: E402
from alpharook.model import load_qnet                        # noqa: E402


def _lab_agent():
    net = load_qnet("models/gen21-cand1.pt")
    net.eval()
    return AnytimeRookAgent(net, BeliefOracle("models/gen15.pt", temp=0.5),
                            budget_scale=0.05, seed=0)


def test_service_decisions_replay_in_lab():
    """Drive one production-shaped hand; seat A1's plays come from the
    service brain (anytime style), everyone else from the family
    heuristic. Every service card must replay bit-exactly in the lab."""
    rng = random.Random(20260805)
    deck = create_deck()
    rng.shuffle(deck)
    log = [{"type": "DEAL", "deck": list(deck)}]
    g = Game(dealer=0)
    g.deal(list(deck))
    styles = ["basic"] * 4
    lab = _lab_agent()
    audited = 0

    while g.phase != HAND_DONE and g.winner is None:
        seat = g.turn
        if g.phase == PLAYING and seat == 0:
            req = DecideReq(dealer="A1", actions=log, style="anytime")
            resp = decide(req)
            act = resp["action"]
            assert act["type"] == "PLAY_CARD" and act["seat"] == "A1"
            card = act["card"]
            cands = g.legal_cards(0)
            if len(cands) > 1:
                think = resp.get("think")
                assert think, "anytime service response missing telemetry"
                # the seed the service derived must match the lab's own
                # derivation from the same public state
                assert think["seed"] == decision_seed(0, g, 0)
                env = SelfPlayGame.__new__(SelfPlayGame)
                env.g = g
                env.picks = []
                env.trump_intent = None
                again = lab.replay(env, 0, D_PLAY, cands,
                                   think["k"], think["ke"])
                assert again == card, (
                    f"lab/service divergence at trick "
                    f"{len(g.completed_tricks)}: lab {again} svc {card}")
                audited += 1
            log.append({"type": "PLAY_CARD", "seat": "A1", "card": card})
            g.play_card(0, card)
            continue
        # everyone else: the family heuristic, logged production-style
        kind, s2, val = next_bot_action(g, styles, rng)
        if kind == "BID":
            log.append({"type": "BID", "seat": SEAT_NAME[s2],
                        "bid": "pass" if val == PASS else val})
            g.bid(s2, val)
        elif kind == "GODOWN":
            log.append({"type": "SELECT_GODOWN", "seat": SEAT_NAME[s2],
                        "cards": list(val)})
            g.select_go_down(s2, list(val))
        elif kind == "TRUMP":
            log.append({"type": "SELECT_TRUMP", "seat": SEAT_NAME[s2],
                        "suit": int(val)})
            g.select_trump(s2, int(val))
        elif kind == "PLAY":
            log.append({"type": "PLAY_CARD", "seat": SEAT_NAME[s2],
                        "card": int(val)})
            g.play_card(s2, int(val))
        else:
            raise AssertionError(f"unexpected bot action {kind}")

    assert audited >= 3, f"only {audited} multi-candidate service plays"


def test_dark_flag_locks_the_style(monkeypatch):
    """With ANYTIME_ENABLED unset the style must refuse — the launch flag
    is a lock, not a default."""
    from fastapi import HTTPException
    import service.brain.main as brain
    monkeypatch.delenv("ANYTIME_ENABLED", raising=False)
    brain._agents.pop("anytime", None)      # force a rebuild attempt
    with pytest.raises(HTTPException) as e:
        brain.get_agent("anytime")
    assert e.value.status_code == 403
    brain._agents.pop("anytime", None)
