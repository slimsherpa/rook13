"""P1.1 gate tests: the anytime searcher plays real hands end-to-end and
every decision is replay-reproducible from its recorded world count.

Small budgets keep this suite honest but fast: the machinery exercised is
exactly the production machinery (belief worlds, C-solver pricing, node
caps, blended stopping) — only the clocks and caps are shrunk.
"""

import random

import pytest

torch = pytest.importorskip("torch")

from rook import csolver as S
from rook.cards import create_deck
from alpharook.anytime import AnytimeRookAgent, decision_seed
from alpharook.beliefs import BeliefOracle
from alpharook.duel import deck_stream
from alpharook.encoder import D_PLAY
from alpharook.env import SelfPlayGame
from alpharook.model import load_qnet

NET = "models/gen21-cand1.pt"
BELIEF = "models/gen15.pt"


def _agent(seed=0):
    net = load_qnet(NET)
    net.eval()
    return AnytimeRookAgent(net, BeliefOracle(BELIEF, temp=0.5),
                            budget_scale=0.05, k_floor_early=3,
                            k_floor_late=3, k_check_min=2, k_max=4,
                            eval_worlds=4, eval_min=2,
                            world_nodes=8_000_000, seed=seed)


def test_node_budget_abort_is_deterministic():
    rng = random.Random(11)
    deck = create_deck()
    rng.shuffle(deck)
    hands = [sorted(deck[s * 9:(s + 1) * 9]) for s in range(4)]
    outcomes = []
    for _ in range(2):
        try:
            S.play_values(hands, 2, 0, 10, only=hands[0][:6],
                          node_budget=200_000)
            outcomes.append(("ok", S.nodes()))
        except S.SolveAbort:
            outcomes.append(("abort", S.nodes()))
    assert outcomes[0] == outcomes[1]
    # a full opening-lead solve needs far more than 200k nodes
    assert outcomes[0][0] == "abort"


def test_decision_seed_is_state_derived():
    env = SelfPlayGame(seed=42, deck_fn=deck_stream(42), dealer=2)
    while True:
        seat, dtype, cands = env.decision()
        if dtype == D_PLAY:
            break
        env.apply(cands[0] if len(cands) == 1 else cands[-1])
    s1 = decision_seed(7, env.g, seat)
    s2 = decision_seed(7, env.g, seat)
    assert s1 == s2
    assert decision_seed(8, env.g, seat) != s1


def test_full_hand_end_to_end_and_replay():
    agent = _agent(seed=3)
    replayer = _agent(seed=3)          # fresh instance, same params
    env = SelfPlayGame(seed=1234, deck_fn=deck_stream(1234), dealer=0)
    checked = 0
    stops = []
    with torch.no_grad():
        while not env.done and env.g.hand_number == 1:
            seat, dtype, cands = env.decision()
            pick = agent.choose(env, seat, dtype, cands)
            if dtype == D_PLAY and len(cands) > 1:
                think = agent.last_think
                assert think is not None
                assert think["k"] >= 1, "no world survived the caps"
                assert agent.last_search is not None
                stops.append(think["stop"])
                # the replay guarantee: same public state + recorded
                # (k, ke) -> bit-identical decision, on a fresh agent
                again = replayer.replay(env, seat, dtype, cands,
                                        think["k"], think["ke"])
                assert again == pick, (
                    f"replay divergence at trick {think['trick']}")
                checked += 1
            env.apply(pick)
    assert checked >= 5, f"only {checked} searched decisions in the hand"
    assert sum(v[0] for v in agent.stats.values()) == checked
    # stop reasons must be recorded stops, not the attempts backstop
    assert set(stops) <= {"obvious", "floor", "budget", "kmax"}, stops


def test_obvious_stop_fires_late_hand():
    """Late tricks are near-free and often unanimous — the obvious-card
    stop (or the k cap) must end them without burning the clock."""
    agent = _agent(seed=5)
    env = SelfPlayGame(seed=777, deck_fn=deck_stream(777), dealer=1)
    stops = []
    with torch.no_grad():
        while not env.done and env.g.hand_number == 1:
            seat, dtype, cands = env.decision()
            pick = agent.choose(env, seat, dtype, cands)
            if (dtype == D_PLAY and len(cands) > 1
                    and len(env.g.completed_tricks) >= 5):
                stops.append((agent.last_think["stop"],
                              agent.last_think["secs"]))
            env.apply(pick)
    assert stops, "hand produced no late multi-candidate decisions"
    assert all(s in ("obvious", "floor", "kmax") for s, _ in stops), stops
    assert all(secs < 2.0 for _, secs in stops), stops
