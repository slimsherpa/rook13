"""gen19 expert-iteration self-play: search workers must emit rows in
exactly VecSelfPlay's format (same encoder, same target blend, same stats
contract) so WorkerPool can mix reflex and expert batches transparently.
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alpharook.model import QNet, load_qnet  # noqa: E402
from alpharook.encoder import STATE_DIM, ACTION_DIM  # noqa: E402
from alpharook.expert import SearchSelfPlay  # noqa: E402
from alpharook.selfplay import VecSelfPlay, SCRIPT_MODES  # noqa: E402

MODELS = Path(__file__).resolve().parents[1] / "models"


def _check_rows(samples, state_dim):
    S = np.stack([r[0] for r in samples])
    A = np.stack([r[1] for r in samples])
    Y = np.array([r[2] for r in samples], dtype=np.float32)
    assert S.shape[1] == state_dim and A.shape[1] == ACTION_DIM
    assert np.isfinite(S).all() and np.isfinite(A).all()
    assert (np.abs(Y) <= 1.0 + 1e-6).all()
    for _, _, _, bt, bm in samples:
        assert bt.shape == (40,) and bm.shape == (40,)
        assert set(np.unique(bt)).issubset({0, 1, 2, 3})


def test_search_selfplay_rows_and_stats():
    net = QNet()  # fresh v1 net: fast, architecture-agnostic path
    sp = SearchSelfPlay(seed=7, opponent_mix=0.5, bid_eps=0.15,
                        script_dtypes=SCRIPT_MODES["none"],
                        worlds=2, min_trick=7, prior=2.0)
    samples, stats = sp.play(net, "cpu", 0.1, 200)
    assert len(samples) >= 200
    _check_rows(samples, STATE_DIM)
    assert stats["games"] == stats["search_games"] >= 1
    assert stats["hands"] >= stats["games"]
    assert stats["mix_games"] <= stats["games"]
    assert sp.games_done == stats["games"]


def test_search_selfplay_matches_vec_row_format():
    net = QNet()
    vec = VecSelfPlay(4, seed=11, script_dtypes=SCRIPT_MODES["none"])
    v_samples, v_stats = vec.play(net, "cpu", 0.1, 50)
    sp = SearchSelfPlay(seed=11, script_dtypes=SCRIPT_MODES["none"],
                        worlds=2, min_trick=7)
    s_samples, s_stats = sp.play(net, "cpu", 0.1, 50)
    for r in (v_samples[0], s_samples[0]):
        assert len(r) == 5
        assert r[0].shape == v_samples[0][0].shape
        assert r[1].shape == (ACTION_DIM,)
    assert set(v_stats) == set(s_stats)


def test_expert_with_champion_stack():
    """The real config: gen13 learner, belief-guided worlds from gen15 —
    one short game slice, proving the full stack wires up."""
    gen13 = MODELS / "gen13.pt"
    gen15 = MODELS / "gen15.pt"
    if not (gen13.exists() and gen15.exists()):
        return  # models not present in this checkout
    net = load_qnet(str(gen13))
    sp = SearchSelfPlay(seed=3, script_dtypes=SCRIPT_MODES["none"],
                        worlds=2, min_trick=6,
                        belief_ckpt=str(gen15), belief_temp=0.5)
    samples, stats = sp.play(net, "cpu", 0.05, 40)
    assert len(samples) >= 40
    _check_rows(samples, net.net[0].in_features - ACTION_DIM)
    assert stats["search_games"] >= 1
