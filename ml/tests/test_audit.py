"""gen14 blunder engine: cloned games must be independent, and the audit's
accounting must be internally consistent."""

import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rook.engine import PLAYING  # noqa: E402
from alpharook.env import SelfPlayGame  # noqa: E402
from alpharook.model import QNet  # noqa: E402
from alpharook.search import SearchAgent  # noqa: E402
from alpharook.encoder import D_PLAY  # noqa: E402
from alpharook.audit import clone_game, audit_game, reflex_playout  # noqa: E402


def mid_play(seed: int) -> SelfPlayGame:
    rng = random.Random(seed)
    env = SelfPlayGame(seed=seed)
    while env.g.phase != PLAYING or len(env.g.completed_tricks) < 2:
        _, _, cands = env.decision()
        env.apply(rng.choice(cands))
    return env


def test_clone_game_is_independent():
    env = mid_play(3)
    g = env.g
    c = clone_game(g)
    seat = c.turn
    card = c.legal_cards(seat)[0]
    c.play_card(seat, card)
    # original untouched by the clone's move
    assert card in g.hands[seat]
    assert len(g.trick_plays) != len(c.trick_plays) or g.hands != c.hands


def test_reflex_playout_finishes_the_hand():
    net = QNet()
    net.eval()
    env = mid_play(5)
    g = clone_game(env.g)
    diff = reflex_playout(g, net)
    assert isinstance(diff, float)
    assert len(g.hand_history) == 1
    h = g.hand_history[-1]
    assert diff == float(h[4] - h[5])


def test_audit_accounting_is_consistent():
    net = QNet()
    net.eval()
    oracle = SearchAgent(net, worlds=2,
                         search_dtypes=frozenset({D_PLAY}), seed=1)
    blunders, st = audit_game(net, oracle, seed=7)
    assert st["decisions"] > 0
    assert 0 <= st["costly"] <= st["decisions"]
    assert 0 <= st["preventable"] <= st["costly"]
    assert st["hands"] >= 1
    assert len(blunders) == st["costly"]
    for b in blunders:
        assert b["cost"] >= 25.0
        assert b["played"] != b["best"]
        assert isinstance(b["preventable"], bool)
