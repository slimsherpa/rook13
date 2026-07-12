"""gen11 search integrity: imagined worlds must be consistent, materialized
games must be faithful to the real engine, and search — like the encoder —
must be blind to hidden information.
"""

import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rook.cards import SEATS, suit_of  # noqa: E402
from rook.engine import BIDDING, WIDOW, TRUMP, PLAYING, HAND_DONE, GAME_OVER  # noqa: E402
from rook.observation import observe, known_voids, seen_cards  # noqa: E402
from rook.determinize import sample_world, hidden_hand_sizes  # noqa: E402
from alpharook.env import SelfPlayGame  # noqa: E402
from alpharook.model import QNet  # noqa: E402
from alpharook.search import materialize, _Sim, SearchAgent  # noqa: E402
from test_leak import scramble_hidden  # noqa: E402


def drive(env: SelfPlayGame, rng: random.Random, steps: int) -> bool:
    """Advance a game `steps` random decisions. Returns False when it ends."""
    for _ in range(steps):
        if env.done:
            return False
        _, _, cands = env.decision()
        env.apply(rng.choice(cands))
    return not env.done


def test_sampled_worlds_are_consistent():
    rng = random.Random(7)
    checked = 0
    for game_seed in range(30):
        env = SelfPlayGame(seed=game_seed)
        while drive(env, rng, rng.randrange(1, 12)):
            if env.g.phase not in (BIDDING, WIDOW, TRUMP, PLAYING):
                continue
            seat, _, _ = env.decision()
            o = observe(env.g, seat)
            hands, go_down = sample_world(o, rng)
            checked += 1

            assert hands[o.seat] == o.hand
            sizes = hidden_hand_sizes(o)
            for s, n in sizes.items():
                assert len(hands[s]) == n, f"seat {s} size"
            # the world + everything already seen partitions the 40 cards
            played = [c for _, plays, _, _ in o.completed_tricks
                      for _, c in plays] + [c for _, c in o.trick_plays]
            world = [c for h in hands for c in h] + list(go_down) + played
            if o.my_go_down:
                assert go_down == o.my_go_down
            assert sorted(world) == list(range(40)), "not a partition"
            # nobody holds a suit they've shown void in
            voids = known_voids(o)
            for s in SEATS:
                if s == o.seat:
                    continue
                assert not any(suit_of(c) in voids[s] for c in hands[s])
    assert checked > 200


def true_world(env: SelfPlayGame):
    g = env.g
    hands = [list(h) for h in g.hands]
    go_down = list(g.widow) if g.phase == BIDDING else list(g.go_down)
    return hands, go_down


def test_materialize_replays_identically_to_engine():
    """Materializing the TRUE hidden world and playing the same moves must
    give the exact same hand result as the real engine."""
    outer = random.Random(11)
    tested = 0
    for game_seed in range(40):
        env = SelfPlayGame(seed=game_seed)
        drive(env, outer, outer.randrange(1, 45))
        if env.done or env.g.phase not in (BIDDING, WIDOW, TRUMP, PLAYING):
            continue
        seat, _, _ = env.decision()
        o = observe(env.g, seat)
        hands, go_down = true_world(env)
        sim = _Sim(materialize(o, hands, go_down, 500, -250),
                   env.picks, env.trump_intent)

        hand_no = env.g.hand_number
        step = random.Random(game_seed ^ 0xBEEF)
        while not sim.hand_over:
            s_env, dt_env, c_env = env.decision()
            s_sim, dt_sim, c_sim = sim.decision()
            assert (s_env, dt_env, c_env) == (s_sim, dt_sim, c_sim)
            a = step.choice(c_env)
            env.apply(a)
            sim.apply(a)

        real = next(h for h in env.g.hand_history if h[0] == hand_no)
        assert sim.g.hand_history[-1][1:] == real[1:], \
            f"hand result diverged: {sim.g.hand_history[-1]} vs {real}"
        tested += 1
    assert tested >= 25


def test_search_is_blind_to_hidden_cards():
    """Same observation + same rng seed -> same search decision, no matter
    how the hidden cards are actually distributed."""
    net = QNet()  # random weights: any net must be leak-free
    net.eval()
    outer = random.Random(23)
    tested = 0
    for game_seed in range(12):
        env = SelfPlayGame(seed=game_seed)
        if not drive(env, outer, outer.randrange(4, 40)):
            continue
        if env.g.phase not in (BIDDING, WIDOW, TRUMP, PLAYING):
            continue
        seat, dtype, cands = env.decision()

        first = SearchAgent(net, worlds=3, seed=99).choose(
            env, seat, dtype, list(cands))
        scramble_hidden(env.g, seat, random.Random(game_seed))
        second = SearchAgent(net, worlds=3, seed=99).choose(
            env, seat, dtype, list(cands))
        assert first == second, "hidden cards influenced the search"
        tested += 1
    assert tested >= 8


def test_search_agent_plays_full_games():
    """Smoke: a search agent (tiny K, random net) makes every decision type
    through complete short games without wedging the engine."""
    net = QNet()
    net.eval()
    agent = SearchAgent(net, worlds=2, seed=5)
    for game_seed in (1, 2):
        env = SelfPlayGame(seed=game_seed, win_score=150, lose_score=-75)
        steps = 0
        while not env.done:
            seat, dtype, cands = env.decision()
            env.apply(agent.choose(env, seat, dtype, cands))
            steps += 1
            assert steps < 2000
        assert env.g.phase == GAME_OVER
