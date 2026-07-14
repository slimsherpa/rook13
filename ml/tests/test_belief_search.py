"""gen16 belief-guided imagination: weighted worlds must obey every
constraint the uniform sampler obeys, actually FOLLOW the posterior when
it speaks, and — like all search — stay blind to the true hidden cards.
"""

import random
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rook.cards import SEATS, suit_of  # noqa: E402
from rook.engine import BIDDING, WIDOW, TRUMP, PLAYING  # noqa: E402
from rook.observation import observe, known_voids  # noqa: E402
from rook.determinize import (  # noqa: E402
    sample_world_weighted, hidden_hand_sizes,
)
from alpharook.env import SelfPlayGame  # noqa: E402
from alpharook.model import QNet  # noqa: E402
from alpharook.encoder import STATE_DIM_V2  # noqa: E402
from alpharook.beliefs import BeliefOracle  # noqa: E402
from alpharook.search import SearchAgent  # noqa: E402
from test_leak import scramble_hidden  # noqa: E402
from test_search import drive  # noqa: E402


def random_posterior(rng: random.Random) -> np.ndarray:
    """A random but valid [40, 4] class distribution — spiky on purpose,
    so degenerate rows (mass on a voided seat) exercise the fallbacks."""
    p = np.array([[rng.random() ** 3 + 1e-9 for _ in range(4)]
                  for _ in range(40)])
    return p / p.sum(axis=1, keepdims=True)


def test_weighted_worlds_are_consistent():
    """sample_world_weighted must satisfy the exact contract of
    sample_world: partition, sizes, voids, own hand/go-down — no matter
    how adversarial the posterior."""
    rng = random.Random(7)
    checked = 0
    for game_seed in range(30):
        env = SelfPlayGame(seed=game_seed)
        while drive(env, rng, rng.randrange(1, 12)):
            if env.g.phase not in (BIDDING, WIDOW, TRUMP, PLAYING):
                continue
            seat, _, _ = env.decision()
            o = observe(env.g, seat)
            hands, go_down = sample_world_weighted(o, rng,
                                                   random_posterior(rng))
            checked += 1

            assert hands[o.seat] == o.hand
            for s, n in hidden_hand_sizes(o).items():
                assert len(hands[s]) == n, f"seat {s} size"
            played = [c for _, plays, _, _ in o.completed_tricks
                      for _, c in plays] + [c for _, c in o.trick_plays]
            world = [c for h in hands for c in h] + list(go_down) + played
            if o.my_go_down:
                assert go_down == o.my_go_down
            assert sorted(world) == list(range(40)), "not a partition"
            voids = known_voids(o)
            for s in SEATS:
                if s == o.seat:
                    continue
                assert not any(suit_of(c) in voids[s] for c in hands[s])
    assert checked > 200


def test_weighted_sampler_follows_the_posterior():
    """When the posterior shouts, the sampler must listen: a card given
    overwhelming mass on relative seat 1 should land there almost always
    (vs ~1/3 uniformly), while flat rows stay near uniform."""
    rng = random.Random(3)
    env = SelfPlayGame(seed=1)  # fresh deal, observer mid-auction
    seat, _, _ = env.decision()
    o = observe(env.g, seat)
    pool = [c for c in range(40) if c not in o.hand]
    target = pool[0]

    probs = np.full((40, 4), 0.25)
    probs[target] = [0.97, 0.01, 0.01, 0.01]
    want = (seat + 1) % 4  # relative class 0 = seat to my left

    hits = 0
    n = 300
    for _ in range(n):
        hands, _gd = sample_world_weighted(o, rng, probs)
        if target in hands[want]:
            hits += 1
    # unconstrained bidding-phase placement: uniform would give ~9/31;
    # demanding 70%+ proves the posterior is driving placement
    assert hits / n > 0.70, f"posterior ignored: {hits}/{n}"


def test_belief_search_is_blind_to_hidden_cards():
    """Belief-guided search sees an Observation and nothing else: same
    observation + same seeds -> same decision, whatever the hidden truth."""
    net = QNet(state_dim=STATE_DIM_V2)  # searching net (v2, random weights)
    net.eval()
    bnet = QNet(state_dim=STATE_DIM_V2, belief=True)
    bnet.eval()
    outer = random.Random(23)
    tested = 0
    for game_seed in range(12):
        env = SelfPlayGame(seed=game_seed)
        if not drive(env, outer, outer.randrange(4, 40)):
            continue
        if env.g.phase not in (BIDDING, WIDOW, TRUMP, PLAYING):
            continue
        seat, dtype, cands = env.decision()

        def agent():
            return SearchAgent(net, worlds=3, seed=99,
                               belief=BeliefOracle(net=bnet))

        first = agent().choose(env, seat, dtype, list(cands))
        scramble_hidden(env.g, seat, random.Random(game_seed))
        second = agent().choose(env, seat, dtype, list(cands))
        assert first == second, "hidden cards influenced belief search"
        tested += 1
    assert tested >= 8
