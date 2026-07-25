"""Mimic-era tests: the bid-history transcript, the v4 encoder's leak
blindness, and the raw-record replay contract used by gen_mimic/the miller."""

import random
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rook.cards import PASS, SEATS  # noqa: E402
from rook.engine import BIDDING, WIDOW  # noqa: E402
from rook.observation import observe  # noqa: E402
from alpharook.env import SelfPlayGame  # noqa: E402
from alpharook.encoder import (  # noqa: E402
    STATE_DIM_V4, auction_features, encode_state_v4,
)
from tests.test_leak import scramble_hidden  # noqa: E402


def _run_auction(env: SelfPlayGame, choose):
    """Drive env until the auction for the current hand is over."""
    while env.g.phase == BIDDING:
        seat, dtype, cands = env.decision()
        env.apply(choose(seat, cands))


def test_bid_history_transcript():
    env = SelfPlayGame(seed=7)
    lead = env.g.turn
    order = [(lead + i) % 4 for i in range(4)]

    # scripted auction: opener bids 70, next raises to 80, opener re-raises
    # to 85, everyone else out
    script = {order[0]: [70, 85, PASS], order[1]: [80, PASS],
              order[2]: [PASS], order[3]: [PASS]}

    def choose(seat, cands):
        want = script[seat].pop(0)
        assert want in cands
        return want

    _run_auction(env, choose)
    hist = env.g.bid_history
    assert (order[0], 70) in hist and (order[1], 80) in hist
    assert (order[0], 85) in hist
    # 85 came after 80 which came after 70 — the story is ordered
    vals = [b for _, b in hist if b != PASS]
    assert vals == sorted(vals) == [70, 80, 85]
    assert env.g.bid_winner == order[0] and env.g.phase == WIDOW

    # the auction block reads the story correctly from the winner's view
    o = observe(env.g, order[0])
    a = auction_features(o)
    assert a[0] == 70 / 120.0          # my first bid
    assert a[4] == 2 / 4.0             # I bid twice
    assert a[8] == 1.0                 # I opened
    r1 = (order[1] - order[0]) % 4
    assert a[12 + r1] == 1.0           # they bid, then backed out
    assert a[17] == 3 / 8.0            # three value bids total

    # transcript resets with the next hand's auction
    while not env.done and env.g.hand_number == 1:
        seat, dtype, cands = env.decision()
        env.apply(random.Random(1).choice(cands))
    if not env.done:
        assert all(b != 85 for _, b in env.g.bid_history)


def test_encoder_v4_blind_to_hidden_cards():
    rng = random.Random(1042)
    checked = 0
    for game_i in range(4):
        env = SelfPlayGame(seed=4321 + game_i)
        while not env.done:
            seat, dtype, candidates = env.decision()
            before = encode_state_v4(observe(env.g, seat), env.picks,
                                     dtype, env.g)
            assert before.shape == (STATE_DIM_V4,)
            scramble_hidden(env.g, seat, rng)
            after = encode_state_v4(observe(env.g, seat), env.picks,
                                    dtype, env.g)
            assert np.array_equal(before, after), (
                f"hidden cards leaked into v4 encoding (game {game_i}, "
                f"dtype {dtype}, seat {seat})")
            env.apply(rng.choice(candidates))
            checked += 1
    assert checked > 250


def test_raw_record_replay_contract():
    """gen_mimic's storage contract: (seed, start, actions) reproduces the
    game bit-identically — including the bid_history the miller relies on."""
    from alpharook.duel import deck_stream

    seed = 20260725
    env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed), dealer=seed % 4)
    env.g.scores = [430, 120]
    rng = random.Random(9)
    actions = []
    transcripts = []
    while not env.done:
        seat, dtype, cands = env.decision()
        a = rng.choice(cands)
        actions.append(a)
        env.apply(a)
        transcripts.append(tuple(env.g.bid_history))
    final = list(env.g.scores)

    env2 = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed), dealer=seed % 4)
    env2.g.scores = [430, 120]
    for i, a in enumerate(actions):
        env2.decision()
        env2.apply(a)
        assert tuple(env2.g.bid_history) == transcripts[i]
    assert env2.done and list(env2.g.scores) == final
