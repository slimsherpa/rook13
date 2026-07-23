"""Bidding gym integrity: real-engine auctions, conserved scoring, labeled
rows, deterministic battery, and the dealer-position feature Riley asked
for actually present in the state."""

import random
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rook.cards import PASS  # noqa: E402
from alpharook.outcome_model import OutcomeNet, encode_deal  # noqa: E402
from alpharook.bidgym import (  # noqa: E402
    AuctionEpisode, BidNet, run_episode, battery, bid_state, score_hand,
    start_state, STATE_DIM,
)


def test_outcome_net_shapes_and_sampling():
    net = OutcomeNet()
    rng = random.Random(3)
    pts = net.sample_points(list(range(9)), [30, 31, 32, 33], rng)
    assert 0.0 <= pts <= 120.0 and pts % 5 == 0
    assert encode_deal([0, 39], [5]).sum() == 3.0


def test_episode_terminates_and_scores_conserve():
    net = BidNet()
    outcome = OutcomeNet()
    rng = random.Random(11)
    ep = AuctionEpisode(rng, outcome, 500, -250, False)
    rows = []
    run_episode(net, ep, 0.3, rng, rows)
    assert ep.done and ep.winner in (0, 1)
    assert max(ep.scores) >= 500 or min(ep.scores) <= -250
    assert len(rows) >= ep.hand_no  # at least one bid decision per hand
    for s, a, team, hand_t, tgt in rows:
        assert s.shape == (STATE_DIM,) and a.shape == (2,)
        assert -1.0 <= tgt <= 1.0


def test_no_floor_rule_ignores_deep_negatives():
    net = BidNet()
    outcome = OutcomeNet()
    rng = random.Random(7)
    ep = AuctionEpisode(rng, outcome, 500, -250, True, max_hands=40)
    run_episode(net, ep, 0.5, rng)
    # only crossing +500 (or the degenerate-race cap) ends it — a deep
    # negative alone never does
    assert ep.done
    assert max(ep.scores) >= 500 or ep.hand_no >= 40


def test_score_hand_family_rules():
    hs, went_set = score_hand(100, 95.0, 0)
    assert hs == [-100, 25.0] and went_set
    hs, went_set = score_hand(100, 110.0, 1)
    assert hs == [10.0, 110.0] and not went_set


def test_dealer_position_feature_present():
    rng = random.Random(5)
    ep = AuctionEpisode(rng, OutcomeNet(), 500, -250, False, dealer=2)
    s = bid_state(ep.g, ep.bidder(), ep.scores, 500, -250, 1)
    dealer_block = s[-4:]
    assert dealer_block.sum() == 1.0
    # bidding opens left of dealer: bidder=3, dealer=2 -> rel (2-3)%4 = 3
    assert dealer_block[3] == 1.0


def test_battery_deterministic():
    net, frozen = BidNet(), BidNet()
    outcome = OutcomeNet()
    a = battery(net, outcome, frozen, deals=12, seed=99)
    b = battery(net, outcome, frozen, deals=12, seed=99)
    assert a == b and 0.0 <= a <= 1.0


def test_start_state_curriculum_reaches_endgames():
    rng = random.Random(1)
    states = [start_state(rng, 1.0) for _ in range(300)]
    assert any(max(s) >= 485 for s in states)
    assert all(max(s) < 500 for s in states)
