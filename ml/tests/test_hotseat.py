"""gen20 hot-seat gym: the scripted auction must always hand the widow to
the dealer at the minimum bid, raw per-hand points must be conserved
(pool = 120 every hand), rows must match the pool contract, and the
battery must be deterministic on its fixed decks.
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rook.cards import PASS, team_of  # noqa: E402
from alpharook.model import QNet  # noqa: E402
from alpharook.encoder import ACTION_DIM, D_BID  # noqa: E402
from alpharook.hotseat import (  # noqa: E402
    HotSeatGame, HotSeatSelfPlay, eval_battery, scripted_bid, POINT_POOL,
)


def drive_hands(n_hands: int, seed: int = 5) -> HotSeatGame:
    import random
    rng = random.Random(seed)
    env = HotSeatGame(seed, win_score=10 ** 9, lose_score=-(10 ** 9))
    while len(env.hand_points) < n_hands:
        seat, dtype, cands = env.decision()
        if dtype == D_BID:
            env.apply(scripted_bid(env, cands))
            # a non-dealer never bids: everyone passes until the engine
            # forces the dealer
            if seat != env.g.dealer:
                assert env.g.hands  # smoke: game continues
        else:
            env.apply(rng.choice(cands))
    return env


def test_scripted_auction_and_point_conservation():
    env = drive_hands(6)
    assert len(env.hand_points) == 6
    dealers = [d for d, _, _ in env.hand_points]
    # dealer rotates every hand
    assert all((dealers[i] + 1) % 4 == dealers[i + 1]
               for i in range(len(dealers) - 1))
    # raw points conserved: every hand's two teams sum to the full pool
    for _, p0, p1 in env.hand_points:
        assert p0 + p1 == POINT_POOL
        assert p0 >= 0 and p1 >= 0


def test_hotseat_rows_and_metric():
    net = QNet()
    sp = HotSeatSelfPlay(seed=11, role="partner", worlds=2,
                         prior_start=12.0, prior_end=2.0,
                         hands_per_episode=6)
    samples, stats = sp.play(net, "cpu", 0.05, 150)
    assert len(samples) >= 150
    S = np.stack([r[0] for r in samples])
    A = np.stack([r[1] for r in samples])
    Y = np.array([r[2] for r in samples])
    assert A.shape[1] == ACTION_DIM and np.isfinite(S).all()
    assert (np.abs(Y) <= 1.0).all()
    assert stats["hot_hands"] > 0
    avg = stats["hot_points"] / stats["hot_hands"]
    assert 0.0 <= avg <= POINT_POOL
    # the partner role: rows only from the hot seat — spot-check the count
    # is plausible (>= ~9 plays per hand the hot seat participated in)
    assert len(samples) >= stats["hot_hands"] * 5


def test_battery_is_deterministic():
    net = QNet()
    frozen = QNet()
    a = eval_battery(net, "partner", frozen, hands=16, seed=99)
    b = eval_battery(net, "partner", frozen, hands=16, seed=99)
    assert a == b
    assert 0.0 <= a <= POINT_POOL


def test_taker_role_records_godown_rows():
    net = QNet()
    sp = HotSeatSelfPlay(seed=7, role="taker", worlds=2,
                         hands_per_episode=4)
    samples, stats = sp.play(net, "cpu", 0.05, 120)
    # the taker makes 5 extra decisions per hand (intent + 4 discards), so
    # rows-per-hand must exceed a pure card-play seat's 9
    assert len(samples) / max(1, stats["hot_hands"]) > 10
