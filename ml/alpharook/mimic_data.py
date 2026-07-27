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
from .encoder import (STATE_DIM_V4, ACTION_DIM, D_PLAY,
                      encode_state_v4, encode_action)
from .env import SelfPlayGame

VAL_MOD = 50           # 2% of games held out, by seed
MAX_CANDS = 16         # bids max out at 12; discards at 13


def is_val_seed(seed: int) -> bool:
    return seed % VAL_MOD == 0


def iter_records(paths: list[Path], want_val: bool):
    for p in paths:
        seen = set()   # duel streams replay their seed space after a
        with open(p) as f:  # crash-relaunch; dedup mirror games per shard
            for line in f:
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue        # torn tail line of a live shard
                if "flip" in rec:   # duel-corpus row (teacher vs gen21)
                    key = (rec["seed"], rec["flip"])
                    if key in seen:
                        continue
                    seen.add(key)
                    if "win" not in rec:
                        # rows dumped before duel.py stamped the format:
                        # keeper convention puts 'std' in the 500/-250 shards
                        rec["win"], rec["lose"] = \
                            (500, -250) if "std" in p.name else (2000, -1000)
                if is_val_seed(rec["seed"]) == want_val:
                    yield rec


def rows_from_record(rec: dict, reflex_keep: float, rng: random.Random,
                     ovr_weight: float):
    """Replay one game; yield (state, dtype, cands, chosen_idx, weight, kind).
    Single-candidate decisions carry no signal and are skipped.

    Two raw formats, one miller:
      gen_mimic — teacher on all 4 seats, curriculum score start; every
        multi-candidate decision is a training row.
      duel corpus (has "flip") — teacher (side 0) vs bare gen21, full game
        from 0-0 at the run's win/lose scores. BOTH sides' decisions replay
        the game, but only the teacher's become rows: gen21's lines are
        what the warm-started student already is."""
    seed = rec["seed"]
    is_duel = "flip" in rec
    if is_duel:
        env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed),
                           dealer=seed % 4, win_score=rec["win"],
                           lose_score=rec["lose"])
    else:
        env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed),
                           dealer=seed % 4)
        env.g.scores = list(rec["start"])
    for d in rec["d"]:
        seat, dtype, action, reflex, srch = d[:5]
        mine = d[5] if is_duel else 1
        s2, d2, cands = env.decision()
        assert s2 == seat and d2 == dtype, f"replay divergence in seed {seed}"
        if mine and len(cands) > 1:
            kind = 2 if (srch and action != reflex) else (1 if srch else 0)
            # reflex subsampling applies ONLY to card plays: auction/widow/
            # trump rows are few, never searched, and load-bearing — the
            # mimic1-a probe duel showed under-trained bidding compounds
            # into a feral auction meta (2290 contracts vs gen13's 1461)
            if kind > 0 or dtype != D_PLAY or rng.random() < reflex_keep:
                state = encode_state_v4(observe(env.g, seat), env.picks,
                                        dtype, env.g, env.trump_intent)
                yield (state, dtype, list(cands), cands.index(action),
                       ovr_weight if kind == 2 else 1.0, kind)
        env.apply(action)


def pack_batch(rows):
    """rows -> padded tensors: S (B,530), A (B,C,50), mask (B,C), target (B),
    weight (B), kind (B), dtype (B)."""
    B = len(rows)
    S = np.zeros((B, STATE_DIM_V4), dtype=np.float32)
    A = np.zeros((B, MAX_CANDS, ACTION_DIM), dtype=np.float32)
    mask = np.zeros((B, MAX_CANDS), dtype=bool)
    tgt = np.zeros(B, dtype=np.int64)
    wgt = np.zeros(B, dtype=np.float32)
    kind = np.zeros(B, dtype=np.int64)
    dts = np.zeros(B, dtype=np.int64)
    for i, (state, dtype, cands, chosen, w, k) in enumerate(rows):
        S[i] = state
        for j, a in enumerate(cands):
            A[i, j] = encode_action(dtype, a)
            mask[i, j] = True
        tgt[i], wgt[i], kind[i], dts[i] = chosen, w, k, dtype
    return (torch.from_numpy(S), torch.from_numpy(A),
            torch.from_numpy(mask), torch.from_numpy(tgt),
            torch.from_numpy(wgt), torch.from_numpy(kind),
            torch.from_numpy(dts))


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
                    try:
                        rows = list(rows_from_record(
                            rec, self.reflex_keep, rng, self.ovr_weight))
                    except AssertionError:
                        continue    # corrupt game: skip it, not the run
                    for row in rows:
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
