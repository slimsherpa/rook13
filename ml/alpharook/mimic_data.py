"""The row-miller: raw gen_mimic records -> supervised training rows.

Generation stored games raw (seed + start scores + action sequence), so this
module replays each game through the real engine and encodes every decision
under ANY encoder — today encode_state_v4 — without re-paying the search
cost. Mill-time is decoupled from generation-time by design.

Row kinds:
  0 = reflex row     (teacher's search never engaged; label == gen13 reflex)
  1 = searched-agree (search ran and confirmed the reflex)
  2 = override       (search DISAGREED with the reflex — the needles)

The train/val split is by GAME (seed % val_mod == 0 -> validation), never by
row: rows from one game are near-duplicates and splitting them across the
boundary would inflate quiz scores.
"""

from __future__ import annotations

import json
import random
from pathlib import Path

import numpy as np
import torch

from rook.observation import observe
from .duel import deck_stream
from .encoder import STATE_DIM_V4, ACTION_DIM, encode_state_v4, encode_action
from .env import SelfPlayGame

VAL_MOD = 50           # 2% of games held out, by seed
MAX_CANDS = 16         # bids max out at 12; discards at 13


def is_val_seed(seed: int) -> bool:
    return seed % VAL_MOD == 0


def iter_records(paths: list[Path], want_val: bool):
    for p in paths:
        with open(p) as f:
            for line in f:
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue        # torn tail line of a live shard
                if is_val_seed(rec["seed"]) == want_val:
                    yield rec


def rows_from_record(rec: dict, reflex_keep: float, rng: random.Random,
                     ovr_weight: float):
    """Replay one game; yield (state, dtype, cands, chosen_idx, weight, kind).
    Single-candidate decisions carry no signal and are skipped."""
    seed = rec["seed"]
    env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed), dealer=seed % 4)
    env.g.scores = list(rec["start"])
    for seat, dtype, action, reflex, srch in rec["d"]:
        s2, d2, cands = env.decision()
        assert s2 == seat and d2 == dtype, f"replay divergence in seed {seed}"
        if len(cands) > 1:
            kind = 2 if (srch and action != reflex) else (1 if srch else 0)
            if kind > 0 or rng.random() < reflex_keep:
                state = encode_state_v4(observe(env.g, seat), env.picks,
                                        dtype, env.g, env.trump_intent)
                yield (state, dtype, list(cands), cands.index(action),
                       ovr_weight if kind == 2 else 1.0, kind)
        env.apply(action)


def pack_batch(rows):
    """rows -> padded tensors: S (B,530), A (B,C,50), mask (B,C), target (B),
    weight (B), kind (B)."""
    B = len(rows)
    S = np.zeros((B, STATE_DIM_V4), dtype=np.float32)
    A = np.zeros((B, MAX_CANDS, ACTION_DIM), dtype=np.float32)
    mask = np.zeros((B, MAX_CANDS), dtype=bool)
    tgt = np.zeros(B, dtype=np.int64)
    wgt = np.zeros(B, dtype=np.float32)
    kind = np.zeros(B, dtype=np.int64)
    for i, (state, dtype, cands, chosen, w, k) in enumerate(rows):
        S[i] = state
        for j, a in enumerate(cands):
            A[i, j] = encode_action(dtype, a)
            mask[i, j] = True
        tgt[i], wgt[i], kind[i] = chosen, w, k
    return (torch.from_numpy(S), torch.from_numpy(A),
            torch.from_numpy(mask), torch.from_numpy(tgt),
            torch.from_numpy(wgt), torch.from_numpy(kind))


class MimicStream(torch.utils.data.IterableDataset):
    """Endless shuffled stream of training rows. Each DataLoader worker
    takes a slice of the shard files and cycles them forever with a
    shuffle buffer, so 'epochs' are implicit."""

    def __init__(self, paths: list[Path], reflex_keep: float = 0.25,
                 ovr_weight: float = 10.0, buffer_rows: int = 50000,
                 seed: int = 0):
        self.paths = sorted(paths)
        self.reflex_keep = reflex_keep
        self.ovr_weight = ovr_weight
        self.buffer_rows = buffer_rows
        self.seed = seed

    def __iter__(self):
        info = torch.utils.data.get_worker_info()
        wid = info.id if info else 0
        nw = info.num_workers if info else 1
        mine = self.paths[wid::nw]
        if not mine:
            return
        rng = random.Random(self.seed * 1000 + wid)
        buf = []
        while True:
            rng.shuffle(mine)
            for p in mine:
                for rec in iter_records([p], want_val=False):
                    for row in rows_from_record(rec, self.reflex_keep, rng,
                                                self.ovr_weight):
                        buf.append(row)
                        if len(buf) >= self.buffer_rows:
                            i = rng.randrange(len(buf))
                            buf[i], buf[-1] = buf[-1], buf[i]
                            yield buf.pop()


def build_val(paths: list[Path], max_games: int = 400):
    """Encode the validation slice once (every row, no subsampling —
    the quiz must be honest). Returns packed tensors."""
    rows, games = [], 0
    rng = random.Random(0)
    for rec in iter_records(paths, want_val=True):
        rows.extend(rows_from_record(rec, 1.0, rng, 1.0))
        games += 1
        if games >= max_games:
            break
    return pack_batch(rows), games
