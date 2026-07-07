"""Vectorized self-play: N full games advance in lockstep, and every step all
pending (state, candidate-action) rows across all games go through the net in
ONE forward pass — that batching is what makes pure-Python self-play fast
enough on a MacBook.

Each decision becomes a training sample; when a game finishes, every sample
from that game is labeled with the final result from that seat's team view:

    target = 0.7 * win/loss(±1)  +  0.3 * clip(score_diff / 500, ±1)

Full games (-250..500), so the net sees game score context and can learn
endgame desperation/protection bidding.
"""

from __future__ import annotations

import random

import numpy as np
import torch

from rook.cards import team_of
from rook.observation import observe
from .encoder import encode_state, encode_action
from .env import SelfPlayGame

WIN_WEIGHT = 0.7
DIFF_WEIGHT = 0.3


def game_targets(env: SelfPlayGame) -> tuple[float, float]:
    """Final blended result for team 0 and team 1."""
    s = env.g.scores
    out = []
    for t in (0, 1):
        wl = 1.0 if env.g.winner == t else -1.0
        diff = max(-1.0, min(1.0, (s[t] - s[1 - t]) / 500.0))
        out.append(WIN_WEIGHT * wl + DIFF_WEIGHT * diff)
    return out[0], out[1]


class VecSelfPlay:
    def __init__(self, n_envs: int, seed: int = 0):
        self.rng = random.Random(seed)
        self.envs = [SelfPlayGame(self.rng.randrange(1 << 30)) for _ in range(n_envs)]
        # per env: list of (state_vec, action_vec, team)
        self.bufs: list[list] = [[] for _ in range(n_envs)]
        self.games_done = 0

    @torch.no_grad()
    def play(self, net, device, epsilon: float, min_samples: int):
        """Returns (samples, stats): samples = list of (state, action, target),
        stats aggregates finished games."""
        out: list[tuple[np.ndarray, np.ndarray, float]] = []
        stats = {"games": 0, "hands": 0, "team0_wins": 0, "sets": 0, "bids": 0}
        net.eval()

        while len(out) < min_samples:
            # ---- gather all pending decisions across envs ----
            seats, dtypes, cands_all, state_rows, action_rows, seg = [], [], [], [], [], [0]
            for env in self.envs:
                seat, dtype, cands = env.decision()
                s = encode_state(observe(env.g, seat), env.picks, dtype, env.g)
                seats.append(seat)
                dtypes.append(dtype)
                cands_all.append(cands)
                for a in cands:
                    state_rows.append(s)
                    action_rows.append(encode_action(dtype, a))
                seg.append(seg[-1] + len(cands))

            S = torch.from_numpy(np.stack(state_rows)).to(device)
            A = torch.from_numpy(np.stack(action_rows)).to(device)
            q = net(S, A).cpu().numpy()

            # ---- pick, record, apply ----
            for i, env in enumerate(self.envs):
                lo, hi = seg[i], seg[i + 1]
                if self.rng.random() < epsilon:
                    j = self.rng.randrange(hi - lo)
                else:
                    j = int(np.argmax(q[lo:hi]))
                self.bufs[i].append(
                    (state_rows[lo + j], action_rows[lo + j], team_of(seats[i])))
                env.apply(cands_all[i][j])

                if env.done:
                    t0, t1 = game_targets(env)
                    for s_vec, a_vec, team in self.bufs[i]:
                        out.append((s_vec, a_vec, t0 if team == 0 else t1))
                    stats["games"] += 1
                    stats["hands"] += len(env.g.hand_history)
                    stats["team0_wins"] += 1 if env.g.winner == 0 else 0
                    stats["sets"] += sum(1 for h in env.g.hand_history if h[6])
                    stats["bids"] += len(env.g.hand_history)
                    self.games_done += 1
                    self.bufs[i] = []
                    self.envs[i] = SelfPlayGame(self.rng.randrange(1 << 30))
        return out, stats
