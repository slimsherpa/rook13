"""ctypes wrapper for the C oracle (csolver.c) — same API as rook.solver.

    from rook import csolver as S     # drop-in: solve / play_values / best_play

Build once per machine (also done automatically on import if the .so is
missing and a compiler exists):

    cc -O3 -shared -fPIC rook/csolver.c -o rook/_csolver.so

Parity is proven by tests/test_csolver_parity.py: identical values to the
Python solver on randomized real-game positions, all tricks, mid-trick
states, with and without `only=`. If the library cannot be built, import
fails loudly — callers choose their fallback explicitly.
"""

from __future__ import annotations

import ctypes
import os
import subprocess

from .cards import TAKING_TRICKS_BONUS, team_of  # noqa: F401 (re-export)
from .solver import TOTAL_POINTS, _BIT, _SUIT, card_name  # noqa: F401

_DIR = os.path.dirname(__file__)
_SO = os.path.join(_DIR, "_csolver.so")
_SRC = os.path.join(_DIR, "csolver.c")

def _build():
    cc = os.environ.get("CC", "cc")
    subprocess.run([cc, "-O3", "-shared", "-fPIC", _SRC, "-o", _SO],
                   check=True)


if not os.path.exists(_SO) or os.path.getmtime(_SO) < os.path.getmtime(_SRC):
    _build()
try:
    _L = ctypes.CDLL(_SO)
except OSError:
    _build()          # wrong-platform binary (e.g. rsynced Mach-O to Linux)
    _L = ctypes.CDLL(_SO)
_L.rk_init.argtypes = [ctypes.c_uint64]
_L.rk_solve.restype = ctypes.c_int
_I32 = ctypes.POINTER(ctypes.c_int32)
_L.rk_solve.argtypes = [ctypes.c_uint64] * 4 + [ctypes.c_int] * 7 + \
    [ctypes.c_int, _I32, _I32]
_L.rk_play_values.restype = None
_L.rk_play_values.argtypes = [ctypes.c_uint64] * 4 + [ctypes.c_int] * 7 + \
    [ctypes.c_int, _I32, _I32, ctypes.POINTER(ctypes.c_int8), _I32]
_L.rk_init(0)


def _mask(h) -> int:
    return h if isinstance(h, int) else sum(_BIT[c] for c in h)


def _trick_arrays(trick):
    n = len(trick)
    ts = (ctypes.c_int32 * 4)(*([s for s, _ in trick] + [0] * (4 - n)))
    tc = (ctypes.c_int32 * 4)(*([c for _, c in trick] + [0] * (4 - n)))
    return n, ts, tc


def solve(hands, trump, leader: int, go_down_pts: int = 0, *,
          t0_tricks: int = 0, tricks_done: int = 0, trick: tuple = (),
          bonus_at: int = 5, bonus: int = TAKING_TRICKS_BONUS) -> int:
    h = [_mask(x) for x in hands]
    n, ts, tc = _trick_arrays(trick)
    return _L.rk_solve(h[0], h[1], h[2], h[3],
                       -1 if trump is None else trump, leader, go_down_pts,
                       t0_tricks, tricks_done, bonus_at, bonus, n, ts, tc)


def play_values(hands, trump, leader: int, go_down_pts: int = 0, *,
                t0_tricks: int = 0, tricks_done: int = 0, trick: tuple = (),
                bonus_at: int = 5, bonus: int = TAKING_TRICKS_BONUS,
                only=None):
    h = [_mask(x) for x in hands]
    n, ts, tc = _trick_arrays(trick)
    out = (ctypes.c_int32 * 40)()
    if only is None:
        oarr = None
    else:
        oarr = (ctypes.c_int8 * 40)()
        for c in only:
            oarr[c] = 1
    _L.rk_play_values(h[0], h[1], h[2], h[3],
                      -1 if trump is None else trump, leader, go_down_pts,
                      t0_tricks, tricks_done, bonus_at, bonus, n, ts, tc,
                      oarr, out)
    return {c: int(out[c]) for c in range(40) if out[c] >= 0}


def best_play(hands, trump, leader: int, go_down_pts: int = 0, *,
              t0_tricks: int = 0, tricks_done: int = 0, trick: tuple = (),
              bonus_at: int = 5, bonus: int = TAKING_TRICKS_BONUS):
    vals = play_values(hands, trump, leader, go_down_pts,
                       t0_tricks=t0_tricks, tricks_done=tricks_done,
                       trick=trick, bonus_at=bonus_at, bonus=bonus)
    turn = (trick[-1][0] + 1) % 4 if trick else leader
    pick = (max if team_of(turn) == 0 else min)(vals, key=vals.get)
    return pick, vals[pick]
