"""gen13 belief machinery: the v2 encoder must stay leak-free, and network
surgery must preserve the donor's function exactly."""

import random
import sys
import tempfile
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rook.observation import observe  # noqa: E402
from alpharook.env import SelfPlayGame  # noqa: E402
from alpharook.model import QNet  # noqa: E402
from alpharook.surgery import graft  # noqa: E402
from alpharook.encoder import (  # noqa: E402
    encode_state, encode_state_v2, encode_action, belief_features,
    STATE_DIM, STATE_DIM_V2, BELIEF_DIM,
)
from test_leak import scramble_hidden  # noqa: E402


def wander(env: SelfPlayGame, rng: random.Random, steps: int) -> bool:
    for _ in range(steps):
        if env.done:
            return False
        _, _, cands = env.decision()
        env.apply(rng.choice(cands))
    return not env.done


def test_v2_encoder_is_blind_to_hidden_cards():
    rng = random.Random(5)
    checked = 0
    for seed in range(25):
        env = SelfPlayGame(seed=seed)
        if not wander(env, rng, rng.randrange(5, 45)):
            continue
        seat, dtype, _ = env.decision()
        o1 = observe(env.g, seat)
        before = encode_state_v2(o1, env.picks, dtype, env.g, env.trump_intent)
        scramble_hidden(env.g, seat, random.Random(seed))
        o2 = observe(env.g, seat)
        after = encode_state_v2(o2, env.picks, dtype, env.g, env.trump_intent)
        assert np.array_equal(before, after), "belief features leaked"
        checked += 1
    assert checked >= 15


def test_belief_block_shape_and_ranges():
    rng = random.Random(9)
    for seed in range(10):
        env = SelfPlayGame(seed=seed)
        if not wander(env, rng, rng.randrange(5, 45)):
            continue
        seat, dtype, _ = env.decision()
        o = observe(env.g, seat)
        b = belief_features(o)
        assert b.shape == (BELIEF_DIM,)
        assert (b >= 0).all() and (b <= 1.5).all()
        v2 = encode_state_v2(o, env.picks, dtype, env.g, env.trump_intent)
        assert v2.shape == (STATE_DIM_V2,)
        assert np.array_equal(
            v2[:STATE_DIM],
            encode_state(o, env.picks, dtype, env.g, env.trump_intent))


def test_surgery_preserves_the_donor_exactly():
    donor = QNet()  # random weights: surgery must work for ANY v1 net
    donor.eval()
    with tempfile.TemporaryDirectory() as td:
        path = str(Path(td) / "donor.pt")
        torch.save({"model": donor.state_dict()}, path)
        grafted = graft(path)

    rng = random.Random(2)
    with torch.no_grad():
        for seed in range(6):
            env = SelfPlayGame(seed=seed)
            if not wander(env, rng, rng.randrange(5, 40)):
                continue
            seat, dtype, cands = env.decision()
            o = observe(env.g, seat)
            s1 = torch.from_numpy(encode_state(
                o, env.picks, dtype, env.g, env.trump_intent)[None])
            s2 = torch.from_numpy(encode_state_v2(
                o, env.picks, dtype, env.g, env.trump_intent)[None])
            for a in cands:
                av = torch.from_numpy(encode_action(dtype, a)[None])
                assert abs(donor(s1, av).item()
                           - grafted(s2, av).item()) < 1e-5
