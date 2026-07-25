"""MIMIC (gen21) teacher-data generator.

The full champion stack — gen13 reflex + gen15 belief worlds + PIMC search
(K worlds, endgame gate) — plays ALL FOUR seats of real full games, and
every decision becomes a supervised label. The student net later clones
these choices in ACTION space (cross-entropy over legal candidates), the
one training channel with a spotless record in this project; no value
regression anywhere.

Records are RAW and replayable, not encoded: one JSON line per game holds
the deck seed, start scores and the action sequence, so ANY future encoder
(v4 human-complete observation and beyond) can re-derive training rows
without regenerating search data. Rows where search overrode the reflex
(`r != a` with `s == 1`) are the needles — the ~1-play-per-hand where the
stack is smarter than gen13 — and get upweighted at training time.

Score curriculum (Riley's meta-game requirement): a fraction of games
start at non-zero scores, half of those with one team near the win
threshold, so bidding rows cover the whole scorecard geometry including
the 495-style endgames.

Game record:
    {"seed": int, "start": [a, b], "final": [a, b], "hands": n,
     "sec": float, "n_dec": int, "n_srch": int, "n_ovr": int,
     "d": [[seat, dtype, action, reflex, searched], ...]}
Deck sequence = duel.deck_stream(seed), dealer = seed % 4. Every game is
SELF-CHECKED by an action replay before it is written.
"""

from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import torch

from .arena import model_choose
from .duel import Side, deck_stream
from .env import SelfPlayGame


def sample_start(rng: random.Random, curriculum: float) -> list[int]:
    """[0, 0] most of the time; otherwise a random score geometry, half of
    them with one team inside striking distance of 500 (endgame block)."""
    if rng.random() >= curriculum:
        return [0, 0]

    def pick(lo: int, hi: int) -> int:
        return 5 * rng.randrange(lo // 5, hi // 5 + 1)

    if rng.random() < 0.5:
        a, b = pick(400, 485), pick(-100, 485)   # someone is close
    else:
        a, b = pick(-150, 400), pick(-150, 400)  # mid-game spread
    return [b, a] if rng.random() < 0.5 else [a, b]


@torch.no_grad()
def play_game(side: Side, seed: int, start: list[int],
              win: int = 500, lose: int = -250):
    env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed), dealer=seed % 4,
                       win_score=win, lose_score=lose)
    env.g.scores = list(start)
    agent, net = side.agent, side.net
    decs: list[list[int]] = []
    n_srch = n_ovr = 0
    while not env.done:
        seat, dtype, cands = env.decision()
        if len(cands) == 1:
            action = reflex = cands[0]
            srch = 0
        else:
            action = agent.choose(env, seat, dtype, cands)
            if agent.last_search is not None:
                # what would bare gen13 have done here? (full cands, pre-prune)
                reflex = model_choose(net, "cpu", env, seat, dtype, cands)
                srch = 1
                n_srch += 1
                n_ovr += int(reflex != action)
            else:
                reflex, srch = action, 0
        decs.append([seat, dtype, int(action), int(reflex), srch])
        env.apply(action)
    return env, decs, n_srch, n_ovr


def replay_check(rec: dict, win: int = 500, lose: int = -250) -> None:
    """Deterministically replay the recorded actions; assert the game
    reproduces bit-identically. Runs on every game before it is written —
    verification is built into generation, and it is search-free so the
    cost is milliseconds against a ~minute of search."""
    env = SelfPlayGame(seed=rec["seed"], deck_fn=deck_stream(rec["seed"]),
                       dealer=rec["seed"] % 4, win_score=win, lose_score=lose)
    env.g.scores = list(rec["start"])
    for seat, dtype, action, _r, _s in rec["d"]:
        s2, d2, cands = env.decision()
        assert s2 == seat and d2 == dtype and action in cands, \
            f"replay divergence at seat {seat} dtype {dtype}"
        env.apply(action)
    assert env.done and list(env.g.scores) == rec["final"], "replay mismatch"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True,
                    help="output JSONL shard (append mode; one line/game)")
    ap.add_argument("--games", type=int, default=1000000)
    ap.add_argument("--seed-base", type=int, required=True,
                    help="game seeds = seed-base + i; keep shard ranges "
                         "disjoint across workers AND boxes")
    ap.add_argument("--net", default="models/gen13.pt")
    ap.add_argument("--belief", default="runs/gen15/best_duel.pt")
    ap.add_argument("--belief-temp", type=float, default=0.5)
    ap.add_argument("--worlds", type=int, default=24)
    ap.add_argument("--min-trick", type=int, default=3)
    ap.add_argument("--prior", type=float, default=2.0)
    ap.add_argument("--curriculum", type=float, default=0.4,
                    help="fraction of games starting at random score states")
    args = ap.parse_args()

    torch.set_num_threads(1)  # one worker = one core; the launcher fans out
    side = Side(args.net, "none", worlds=args.worlds, search="play",
                prior=args.prior, min_trick=args.min_trick,
                belief_ckpt=args.belief, belief_temp=args.belief_temp)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    done = sum(1 for _ in open(out)) if out.exists() else 0  # resume-safe
    rng = random.Random(args.seed_base ^ 0x5EED)

    with open(out, "a") as f:
        for i in range(args.games):
            # burn curriculum draws for already-done games so a resumed
            # shard continues the same seed->start mapping
            start = sample_start(rng, args.curriculum)
            if i < done:
                continue
            seed = args.seed_base + i
            t0 = time.time()
            env, decs, n_srch, n_ovr = play_game(side, seed, start)
            rec = {"seed": seed, "start": start,
                   "final": [int(s) for s in env.g.scores],
                   "hands": len(env.g.hand_history),
                   "sec": round(time.time() - t0, 1),
                   "n_dec": len(decs), "n_srch": n_srch, "n_ovr": n_ovr,
                   "d": decs}
            replay_check(rec)
            f.write(json.dumps(rec) + "\n")
            f.flush()
            print(f"[{out.stem} g{i}] seed {seed} start {start} "
                  f"final {rec['final']} hands {rec['hands']} "
                  f"dec {rec['n_dec']} srch {n_srch} ovr {n_ovr} "
                  f"{rec['sec']}s", flush=True)


if __name__ == "__main__":
    main()
