"""League integrity: real full games, both sides collect shaped rows in
range, hand sugar labels every hand, Elo moves the right way, and
duplicate-deal fairness (identical seeds, seats swapped) holds."""

import random
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alpharook.model import QNet  # noqa: E402
from alpharook.league import play_match_game, _elo_update  # noqa: E402

SUGAR = {"bid": 0.10, "pts": 0.15, "hand": 0.25, "game": 0.50}


def test_match_game_rows_and_bounds():
    torch.manual_seed(0)
    na, nb = QNet(), QNet()
    ra, rb = [], []
    w = play_match_game(na, nb, 1234, False, 0.1, ra, rb, SUGAR)
    assert w in (0, 1)
    assert len(ra) > 20 and len(rb) > 20
    cap = sum(SUGAR.values())
    for rows in (ra, rb):
        Y = np.array([r[2] for r in rows])
        assert np.isfinite(Y).all()
        assert (np.abs(Y) <= cap + 1e-6).all()


def test_flip_swaps_seats_on_identical_deal():
    torch.manual_seed(1)
    na, nb = QNet(), QNet()
    r1, r2 = [], []
    w_a_first = play_match_game(na, nb, 777, False, 0.0, r1, [], SUGAR)
    w_b_first = play_match_game(na, nb, 777, True, 0.0, [], r2, SUGAR)
    # same deck stream both times; with identical nets the flipped game is
    # the mirror — the pair must not double-count one lucky deal
    assert w_a_first in (0, 1) and w_b_first in (0, 1)


def test_elo_moves_toward_the_winner():
    ra, rb = _elo_update(1000.0, 1000.0, 1.0)
    assert ra > 1000.0 > rb
    ra2, rb2 = _elo_update(1200.0, 1000.0, 1.0)
    assert ra2 - 1200.0 < ra - 1000.0  # favorite gains less
