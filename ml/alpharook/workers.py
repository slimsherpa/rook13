"""Parallel self-play: N worker processes, each running its own VecSelfPlay,
pooled by the learner every iteration.

Round-based and synchronous (send weights -> collect -> train), which keeps
the DMC on-policy property and stays simple; on an M1 Pro this turns ~1.2
busy cores into ~8 and multiplies samples/second accordingly. Workers pin
torch to one thread each so they don't fight over cores.
"""

from __future__ import annotations

import numpy as np
import torch
import torch.multiprocessing as mp

from .selfplay import VecSelfPlay

STAT_KEYS = ("games", "hands", "sets", "bids", "mix_games", "mix_wins")


def _worker_main(conn, worker_id: int, n_envs: int, seed: int,
                 opponent_mix: float, opponent_style: str, bid_eps: float,
                 script_dtypes_list: list[int]):
    torch.set_num_threads(1)
    from .model import QNet  # construct after spawn, inside the child
    net = QNet()
    vec = VecSelfPlay(n_envs, seed=seed, opponent_mix=opponent_mix,
                      opponent_style=opponent_style, bid_eps=bid_eps,
                      script_dtypes=frozenset(script_dtypes_list))
    while True:
        msg = conn.recv()
        if msg[0] == "stop":
            conn.close()
            return
        _, state_dict, epsilon, n_samples = msg
        net.load_state_dict(state_dict)
        samples, stats = vec.play(net, "cpu", epsilon, n_samples)
        S = np.stack([s for s, _, _ in samples])
        A = np.stack([a for _, a, _ in samples])
        Y = np.array([y for _, _, y in samples], dtype=np.float32)
        conn.send((S, A, Y, stats, vec.games_done))


class WorkerPool:
    def __init__(self, n_workers: int, n_envs: int, seed: int,
                 opponent_mix: float, opponent_style: str, bid_eps: float,
                 script_dtypes: frozenset):
        ctx = mp.get_context("spawn")
        self.conns = []
        self.procs = []
        for w in range(n_workers):
            parent, child = ctx.Pipe()
            p = ctx.Process(
                target=_worker_main,
                args=(child, w, n_envs, seed * 7919 + w * 104729 + 1,
                      opponent_mix, opponent_style, bid_eps,
                      sorted(script_dtypes)),
                daemon=True)
            p.start()
            child.close()
            self.conns.append(parent)
            self.procs.append(p)
        self.games_done = 0

    def collect(self, net, epsilon: float, total_samples: int):
        """Broadcast weights, gather ~total_samples across all workers.
        Returns (S, A, Y) numpy arrays and merged stats."""
        state_dict = {k: v.cpu() for k, v in net.state_dict().items()}
        per_worker = max(1, total_samples // len(self.conns))
        for c in self.conns:
            c.send(("collect", state_dict, epsilon, per_worker))
        S_l, A_l, Y_l = [], [], []
        stats = {k: 0 for k in STAT_KEYS}
        games_done = 0
        for c in self.conns:
            S, A, Y, st, gd = c.recv()
            S_l.append(S)
            A_l.append(A)
            Y_l.append(Y)
            for k in STAT_KEYS:
                stats[k] += st[k]
            games_done += gd
        self.games_done = games_done
        return np.concatenate(S_l), np.concatenate(A_l), np.concatenate(Y_l), stats

    def close(self):
        for c in self.conns:
            try:
                c.send(("stop",))
            except (BrokenPipeError, OSError):
                pass
        for p in self.procs:
            p.join(timeout=5)
            if p.is_alive():
                p.terminate()
