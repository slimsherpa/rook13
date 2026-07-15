"""gen16 plan tree: forked rollouts must degrade gracefully to the old
single-line search, survive whole games, and stay observation-blind.
"""

import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rook.engine import BIDDING, WIDOW, TRUMP, PLAYING, GAME_OVER  # noqa: E402
from alpharook.env import SelfPlayGame  # noqa: E402
from alpharook.model import QNet  # noqa: E402
from alpharook.search import SearchAgent  # noqa: E402
from test_leak import scramble_hidden  # noqa: E402
from test_search import drive  # noqa: E402


def test_fork_width_one_equals_no_forking():
    """A fork over exactly the top-1 candidate IS the argmax line, so
    depth-N width-1 must choose identically to depth-0 — the max-backup
    plumbing cannot change values when every group has one leaf."""
    net = QNet()
    net.eval()
    outer = random.Random(31)
    tested = 0
    for game_seed in range(14):
        env = SelfPlayGame(seed=game_seed)
        if not drive(env, outer, outer.randrange(4, 40)):
            continue
        if env.g.phase not in (BIDDING, WIDOW, TRUMP, PLAYING):
            continue
        seat, dtype, cands = env.decision()
        flat = SearchAgent(net, worlds=3, seed=77).choose(
            env, seat, dtype, list(cands))
        tree = SearchAgent(net, worlds=3, seed=77, fork_depth=3,
                           fork_width=1).choose(env, seat, dtype, list(cands))
        assert flat == tree, "width-1 tree diverged from single-line search"
        tested += 1
    assert tested >= 8


def test_tree_search_is_blind_to_hidden_cards():
    net = QNet()
    net.eval()
    outer = random.Random(41)
    tested = 0
    for game_seed in range(12):
        env = SelfPlayGame(seed=game_seed)
        if not drive(env, outer, outer.randrange(4, 40)):
            continue
        if env.g.phase not in (BIDDING, WIDOW, TRUMP, PLAYING):
            continue
        seat, dtype, cands = env.decision()
        first = SearchAgent(net, worlds=3, seed=99, fork_depth=2,
                            fork_width=2).choose(env, seat, dtype, list(cands))
        scramble_hidden(env.g, seat, random.Random(game_seed))
        second = SearchAgent(net, worlds=3, seed=99, fork_depth=2,
                             fork_width=2).choose(env, seat, dtype, list(cands))
        assert first == second, "hidden cards influenced tree search"
        tested += 1
    assert tested >= 8


def test_tree_agent_plays_full_games():
    """Smoke: forked search makes every decision type through complete
    short games without wedging the engine."""
    net = QNet()
    net.eval()
    agent = SearchAgent(net, worlds=2, seed=5, fork_depth=2, fork_width=2)
    for game_seed in (1, 2):
        env = SelfPlayGame(seed=game_seed, win_score=150, lose_score=-75)
        steps = 0
        while not env.done:
            seat, dtype, cands = env.decision()
            env.apply(agent.choose(env, seat, dtype, cands))
            steps += 1
            assert steps < 2000
        assert env.g.phase == GAME_OVER


def test_plan_lines_are_blind_to_hidden_cards():
    net = QNet()
    net.eval()
    outer = random.Random(53)
    tested = 0
    for game_seed in range(12):
        env = SelfPlayGame(seed=game_seed)
        if not drive(env, outer, outer.randrange(4, 40)):
            continue
        if env.g.phase not in (BIDDING, WIDOW, TRUMP, PLAYING):
            continue
        seat, dtype, cands = env.decision()
        first = SearchAgent(net, worlds=3, seed=99, plan_lines=2).choose(
            env, seat, dtype, list(cands))
        scramble_hidden(env.g, seat, random.Random(game_seed))
        second = SearchAgent(net, worlds=3, seed=99, plan_lines=2).choose(
            env, seat, dtype, list(cands))
        assert first == second, "hidden cards influenced plan search"
        tested += 1
    assert tested >= 8


def test_plan_agent_plays_full_games():
    """Smoke: plan-line search survives complete short games, planning at
    every searched play decision."""
    net = QNet()
    net.eval()
    agent = SearchAgent(net, worlds=2, seed=5, plan_lines=2)
    for game_seed in (3, 4):
        env = SelfPlayGame(seed=game_seed, win_score=150, lose_score=-75)
        steps = 0
        while not env.done:
            seat, dtype, cands = env.decision()
            env.apply(agent.choose(env, seat, dtype, cands))
            steps += 1
            assert steps < 2000
        assert env.g.phase == GAME_OVER
