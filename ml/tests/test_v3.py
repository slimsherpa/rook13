"""v3 encoder: dealer sense added without disturbing anything the donor
knew — the graft must be function-preserving, and the dealer block must
point at the right seat."""

import random
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rook.observation import observe  # noqa: E402
from alpharook.encoder import (  # noqa: E402
    encode_state_for, encode_state_v2, STATE_DIM_V2, STATE_DIM_V3,
)
from alpharook.env import SelfPlayGame  # noqa: E402
from alpharook.model import load_qnet  # noqa: E402
from alpharook.surgery import graft_dealer  # noqa: E402
from alpharook.encoder import encode_action, D_BID  # noqa: E402

MODELS = Path(__file__).resolve().parents[1] / "models"


def test_dealer_block_points_at_the_dealer():
    env = SelfPlayGame(seed=9, dealer=2)
    seat, dtype, cands = env.decision()
    o = observe(env.g, seat)

    class Fake:
        net = [type("L", (), {"in_features": STATE_DIM_V3 + 50})()]
    x = encode_state_for(Fake(), o, env.picks, dtype, env.g, env.trump_intent)
    block = x[STATE_DIM_V2:STATE_DIM_V3]
    assert block.sum() == 1.0
    assert block[(2 - seat) % 4] == 1.0
    # and the v2 prefix is untouched
    assert np.allclose(x[:STATE_DIM_V2],
                       encode_state_v2(o, env.picks, dtype, env.g,
                                       env.trump_intent))


def test_graft_preserves_the_donor_exactly():
    donor_path = MODELS / "gen13.pt"
    if not donor_path.exists():
        return
    donor = load_qnet(str(donor_path))
    v3 = graft_dealer(str(donor_path))
    env = SelfPlayGame(seed=4, dealer=1)
    rng = random.Random(0)
    for _ in range(30):
        if env.done:
            break
        seat, dtype, cands = env.decision()
        o = observe(env.g, seat)
        s2 = encode_state_v2(o, env.picks, dtype, env.g, env.trump_intent)
        s3 = encode_state_for(v3, o, env.picks, dtype, env.g,
                              env.trump_intent)
        A = torch.from_numpy(np.stack([encode_action(dtype, a)
                                       for a in cands]))
        with torch.no_grad():
            q2 = donor(torch.from_numpy(np.stack([s2] * len(cands))), A)
            q3 = v3(torch.from_numpy(np.stack([s3] * len(cands))), A)
        assert torch.allclose(q2, q3, atol=1e-5)
        env.apply(rng.choice(cands))
