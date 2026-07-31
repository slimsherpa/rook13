"""BidBrain corpus: millions of real -250/+500 games against the frozen
house, with exploration bids — "do it thousands of times and get a feel."

Every game: all four seats PLAY with gen23 reflex (cards, go-down, trump
— never varies). One team is the EXPLORER: each of its bid decisions is,
with probability epsilon, a uniformly random legal bid (including PASS,
including wild jumps, including desperate 105s) — otherwise gen23's own
choice. The other team bids pure gen23, so the table stays realistic.

Why exploration is the new ingredient: an argmax-only corpus can never
answer "what if I had bluffed here?" — the counterfactual bids simply
never occur. Epsilon-random bids make the data CONTAIN bluffs, sandbags,
pushes and panic jumps, each tagged with how the whole game actually
ended. The trainer then learns P(win | situation, bid) and the argmax
over that curve IS the best response — bluffing included, if bluffing
actually wins games.

Rows are stored RAW (cards, full bid sequence, dealer, scores) so the
feature encoding can evolve without regenerating games. One JSONL line
per game; both teams' decisions are logged (the house's argmax rows are
free extra signal), each row tagged with was_random and with its team's
final outcome.

    ~/torch-env/bin/python -m alpharook.bidbrain_data --hours 4 --workers 8
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import random
import time

import torch

from rook.cards import team_of
from .arena import model_choose
from .duel import deck_stream
from .encoder import D_BID
from .env import SelfPlayGame
from .model import load_qnet

OUT_DIR = "runs/gen24/bidbrain/shards"
GAMES_PER_SHARD = 1000


@torch.no_grad()
def play_explore_game(net, seed: int, explorer_team: int, hazard: float,
                      rng: random.Random,
                      win_score: int = 500, lose_score: int = -250):
    """SINGLE-DEVIATION exploration (v2 — the v1 eps=0.3 chaos corpus is
    quarantined in shards_chaos_eps30/): at most ONE bid decision per game
    is uniformly random; every other decision by both teams is pure house.
    Each game therefore measures exactly "deviate here, then play like the
    house" — one-step best-response credit with no chaos pollution. The
    per-decision hazard is geometric, biasing deviations toward EARLY
    auction states (floor 65-95), which the v1 audit showed were starved."""
    env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed),
                       dealer=seed % 4,
                       win_score=win_score, lose_score=lose_score)
    rows = []
    deviated = False
    while not env.done:
        seat, dtype, cands = env.decision()
        if dtype == D_BID:
            g = env.g
            was_random = 0
            if team_of(seat) == explorer_team and len(cands) > 1 \
                    and not deviated and rng.random() < hazard:
                action = rng.choice(cands)
                was_random = 1
                deviated = True
            else:
                action = model_choose(net, "cpu", env, seat, dtype, cands)
            rows.append(dict(
                s=seat, t=team_of(seat),
                h=sorted(g.hands[seat]),            # 9 cards at decision
                bh=[[s2, b] for s2, b in g.bid_history],
                d=g.dealer, hn=g.hand_number,
                sc=[int(g.scores[0]), int(g.scores[1])],  # absolute teams
                c=list(cands), a=int(action), r=was_random))
            env.apply(action)
        else:
            env.apply(model_choose(net, "cpu", env, seat, dtype, cands))
    g = env.g
    return dict(seed=seed, x=explorer_team, w=int(g.winner),
                hands=len(g.hand_history), rows=rows)


def worker(worker_id: int, args):
    torch.set_num_threads(1)
    net = load_qnet(args.net)
    rng = random.Random(0xB1D + worker_id * 7919)
    os.makedirs(args.out, exist_ok=True)
    existing = len(glob.glob(os.path.join(args.out, f"w{worker_id}_*.jsonl")))
    shard_n = existing
    t_end = time.time() + args.hours * 3600
    seed_base = args.seed_base + worker_id * 50_000_000 \
        + existing * GAMES_PER_SHARD
    games = 0
    while time.time() < t_end:
        path = os.path.join(args.out, f"w{worker_id}_{shard_n:04d}.jsonl")
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            for i in range(GAMES_PER_SHARD):
                seed = seed_base + games
                rec = play_explore_game(net, seed, explorer_team=seed % 2,
                                        hazard=args.hazard, rng=rng)
                f.write(json.dumps(rec) + "\n")
                games += 1
                if time.time() > t_end:
                    break
        os.replace(tmp, path)   # only whole shards are visible to training
        shard_n += 1
        if worker_id == 0:
            print(f"  [w0] shard {shard_n} done, ~{games} games/worker, "
                  f"{(t_end - time.time()) / 60:.0f} min left", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=float, default=4.0)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--hazard", type=float, default=0.12,
                    help="per-decision deviation hazard; at most one "
                         "deviation per game")
    ap.add_argument("--net", default="models/gen23-cand1.pt")
    ap.add_argument("--out", default=OUT_DIR)
    ap.add_argument("--seed-base", type=int, default=1_000_000_000)
    args = ap.parse_args()
    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    procs = [ctx.Process(target=worker, args=(w, args))
             for w in range(args.workers)]
    for p in procs:
        p.start()
    print(f"bidbrain corpus v2 (single-deviation): {args.workers} workers, "
          f"hazard={args.hazard}, {args.hours}h -> {args.out}", flush=True)
    for p in procs:
        p.join()
    print("CORPUS RUN DONE", flush=True)


if __name__ == "__main__":
    main()
