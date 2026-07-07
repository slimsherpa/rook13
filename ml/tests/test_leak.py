"""Rule integrity: the neural encoder must be blind to hidden information.

We build real mid-game positions, then shuffle the cards the observer cannot
see (other players' hands + the hidden go-down) among themselves. If the
encoder output changes, hidden state leaked into the features — fail.
"""

import random
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rook.cards import SEATS, PASS  # noqa: E402
from rook.engine import Game, GAME_OVER, PLAYING  # noqa: E402
from rook.observation import observe  # noqa: E402
from alpharook.env import SelfPlayGame  # noqa: E402
from alpharook.encoder import encode_state, encode_action  # noqa: E402


def scramble_hidden(g: Game, seat: int, rng: random.Random) -> None:
    """Redistribute all cards hidden from `seat` (other hands + go-down),
    preserving each zone's size. The observation for `seat` must not change."""
    zones = [s for s in SEATS if s != seat]
    pool = [c for s in zones for c in g.hands[s]]
    gd_hidden = g.bid_winner != seat
    if gd_hidden:
        pool.extend(g.go_down)
    rng.shuffle(pool)
    i = 0
    for s in zones:
        n = len(g.hands[s])
        g.hands[s] = pool[i:i + n]
        i += n
    if gd_hidden:
        g.go_down = pool[i:]


def test_encoder_blind_to_hidden_cards():
    rng = random.Random(42)
    checked = 0
    for game_i in range(8):
        env = SelfPlayGame(seed=1234 + game_i)
        while not env.done:
            seat, dtype, candidates = env.decision()
            obs = observe(env.g, seat)
            before = encode_state(obs, env.picks, dtype, env.g)
            act_before = [encode_action(dtype, a) for a in candidates]

            # scramble everything this seat can't see and re-encode
            scramble_hidden(env.g, seat, rng)
            obs2 = observe(env.g, seat)
            after = encode_state(obs2, env.picks, dtype, env.g)
            act_after = [encode_action(dtype, a) for a in candidates]

            assert np.array_equal(before, after), (
                f"hidden cards leaked into state encoding (game {game_i}, "
                f"decision type {dtype}, seat {seat})")
            for b, a in zip(act_before, act_after):
                assert np.array_equal(b, a), "hidden cards leaked into action encoding"

            # scrambling must also keep the game legal to continue: candidates
            # for the observer are unchanged by construction (their hand is theirs)
            env.apply(rng.choice(candidates))
            checked += 1
    assert checked > 500  # sanity: we actually exercised plenty of decisions
