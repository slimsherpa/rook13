"""P1.3 machinery tests: MortalWidow makes a legal, deterministic,
telemetry-recorded (go-down, trump) decision through the env stream."""

import pytest

torch = pytest.importorskip("torch")

from rook.engine import PLAYING
from alpharook.beliefs import BeliefOracle
from alpharook.duel import deck_stream
from alpharook.encoder import D_DISCARD, D_TRUMP
from alpharook.env import SelfPlayGame
from alpharook.model import load_qnet
from alpharook.mortalwidow import MortalWidowAgent

NET = "models/gen21-cand1.pt"
BELIEF = "models/gen15.pt"


def _agent(seed=0):
    net = load_qnet(NET)
    net.eval()
    return MortalWidowAgent(net, BeliefOracle(BELIEF, temp=0.5),
                            budget_s=120.0, k_min=3, k_max=6,
                            eval_worlds=4, menu_samples=3, seed=seed)


def _drive_to_play(agent, game_seed):
    """Play one hand's auction + widow with the agent making every
    decision; stop once card play begins. Returns (env, widow_seat)."""
    env = SelfPlayGame(seed=game_seed, deck_fn=deck_stream(game_seed),
                       dealer=game_seed % 4)
    widow_seat = None
    with torch.no_grad():
        while env.g.phase != PLAYING:
            seat, dtype, cands = env.decision()
            pick = agent.choose(env, seat, dtype, cands)
            assert pick in cands, f"illegal {dtype} choice {pick}"
            if dtype == D_TRUMP:
                widow_seat = seat
            env.apply(pick)
    return env, widow_seat


def test_widow_decision_end_to_end():
    agent = _agent(seed=1)
    env, widow_seat = _drive_to_play(agent, game_seed=4321)
    w = agent.last_widow
    assert w is not None and widow_seat is not None
    assert w["k"] >= 1
    assert w["stop"] in ("obvious", "budget", "kmax")
    assert w["n_cands"] >= 4
    # the burial the engine actually recorded matches the search's choice
    disc, trump = w["choice"]
    assert sorted(env.g.go_down) == sorted(disc)
    assert env.g.trump == trump
    assert agent.stats[0] == 1


def test_widow_decision_is_deterministic():
    c1 = _agent(seed=9)
    c2 = _agent(seed=9)
    _drive_to_play(c1, game_seed=5150)
    _drive_to_play(c2, game_seed=5150)
    assert c1.last_widow["choice"] == c2.last_widow["choice"]
    assert c1.last_widow["k"] == c2.last_widow["k"]
    assert c1.last_widow["seed"] == c2.last_widow["seed"]
