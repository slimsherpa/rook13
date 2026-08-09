"""P2 — BidBot's training food: twin rows -> full-view feature tensors.

The twin corpus stores (seed, hn, dec, deviation, dwp) — a pointer plus a
label, per the dump-actions law. The mainline game that reached each
decision was pure reflex self-play, fully deterministic given the seed,
so this module replays every game with the same net, stops at each
recorded bid-decision ordinal, audits that the replay matches the row
(seat, house bid, scores — byte-exact or the row is dropped and counted),
and encodes the complete at-the-table view:

  * encode_state_v4 — hand, standing bids, floor/must-bid, dealer, game
    scores & distances, own-hand strength, the v4 auction summary;
  * the EXACT ordered auction transcript (last 16 events verbatim, rel
    seat + value each) — v4 summarizes raises, this block keeps them all
    ("it needs to know EVERY bid");
  * wp_now — the winprob25 read of the score state at the moment of the
    bid, the same table that priced the labels.

Rows are deduped on (seed, hn, dec, dev) — worker restarts in the July
soak left ~1.4% doubles. Output is one npz the trainer mmaps.

    ~/torch-env/bin/python -m alpharook.bidbot_features \
        --twins "runs/p2/twins/*.jsonl" --out runs/p2/bidbot_train.npz
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import time

import numpy as np
import torch

from rook.cards import PASS, VALID_BIDS, team_of
from rook.observation import observe
from .arena import model_choose
from .duel import deck_stream
from .encoder import D_BID, STATE_DIM_V4, encode_state_v4
from .env import SelfPlayGame
from .model import load_qnet
from .winprob import WinProb

ACTIONS = (PASS,) + tuple(VALID_BIDS)          # 13 fixed action slots
A_INDEX = {a: i for i, a in enumerate(ACTIONS)}
SEQ_LEN = 16                                   # auction events kept verbatim
SEQ_DIM = SEQ_LEN * 6                          # [rel-seat 4, is_pass, value/120]
FEAT_DIM = STATE_DIM_V4 + SEQ_DIM + 1          # + wp_now


def bid_sequence_block(o) -> np.ndarray:
    a = np.zeros(SEQ_DIM, dtype=np.float32)
    for i, (s, b) in enumerate(o.bid_history[-SEQ_LEN:]):
        j = i * 6
        a[j + (s - o.seat) % 4] = 1.0
        if b == PASS:
            a[j + 4] = 1.0
        else:
            a[j + 5] = b / 120.0
    return a


def bid_features(g, seat: int, wp: WinProb) -> np.ndarray:
    o = observe(g, seat)
    t = team_of(seat)
    wpn = wp(g.scores[t], g.scores[1 - t], g.win_score, g.lose_score)
    return np.concatenate([
        encode_state_v4(o, [], D_BID, g, None),
        bid_sequence_block(o),
        np.array([wpn], dtype=np.float32),
    ]).astype(np.float32)


def parse_bid(v) -> int:
    return PASS if v == "pass" else int(v)


@torch.no_grad()
def replay_game(net, wp, seed: int, wants: dict[int, dict], out: dict,
                audit: list) -> None:
    """Replay one mainline game; capture features at each wanted ordinal."""
    env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed), dealer=seed % 4)
    dec = 0
    last = max(wants)
    while not env.done:
        seat, dtype, cands = env.decision()
        if dtype == D_BID:
            dec += 1
            house = model_choose(net, "cpu", env, seat, D_BID, cands)
            rows = wants.get(dec, ())
            feats = None
            for r in rows:
                rec_house = parse_bid(r["house"])
                ok = (r["seat"] == seat and rec_house == house
                      and r["hn"] == env.g.hand_number
                      and list(env.g.scores) == r["scores"])
                audit.append(ok)
                if not ok:
                    continue
                if feats is None:
                    feats = bid_features(env.g, seat, wp)
                mask = 0
                for c in cands:
                    mask |= 1 << A_INDEX[c]
                t = r["team"]
                out["x"].append(feats)
                out["house_i"].append(A_INDEX[house])
                out["dev_i"].append(A_INDEX[parse_bid(r["dev"])])
                out["dwp"].append(r["dwp"])
                out["my_a"].append(r["hand_a"][t])
                out["my_b"].append(r["hand_b"][t])
                out["mask"].append(mask)
                out["seed"].append(seed)
            if dec >= last:
                return
            env.apply(house)
            continue
        env.apply(model_choose(net, "cpu", env, seat, dtype, cands))


def worker(worker_id: int, args, seeds: list, rows_by_seed: dict) -> None:
    torch.set_num_threads(1)
    net = load_qnet(args.net)
    net.eval()
    wp = WinProb(args.winprob)
    out = {k: [] for k in ("x", "house_i", "dev_i", "dwp", "my_a", "my_b",
                           "mask", "seed")}
    audit: list = []
    t0 = time.time()
    for i, seed in enumerate(seeds):
        replay_game(net, wp, seed, rows_by_seed[seed], out, audit)
        if worker_id == 0 and (i + 1) % 50 == 0:
            print(f"  [w0] {i + 1}/{len(seeds)} games, "
                  f"{len(out['dwp'])} rows, "
                  f"{sum(audit)}/{len(audit)} audits ok, "
                  f"{time.time() - t0:.0f}s", flush=True)
    np.savez_compressed(
        f"{args.out}.w{worker_id}",
        x=np.stack(out["x"]) if out["x"] else np.zeros((0, FEAT_DIM), np.float32),
        house_i=np.array(out["house_i"], np.int8),
        dev_i=np.array(out["dev_i"], np.int8),
        dwp=np.array(out["dwp"], np.float32),
        my_a=np.array(out["my_a"], np.float32),
        my_b=np.array(out["my_b"], np.float32),
        mask=np.array(out["mask"], np.uint16),
        seed=np.array(out["seed"], np.int64),
        audit_ok=np.array([sum(audit)], np.int64),
        audit_n=np.array([len(audit)], np.int64),
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--twins", default="runs/p2/twins/*.jsonl")
    ap.add_argument("--net", default="models/gen21-cand1.pt")
    ap.add_argument("--winprob", default="models/winprob25.json")
    ap.add_argument("--out", default="runs/p2/bidbot_train.npz")
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--limit-games", type=int, default=0,
                    help="smoke: replay only the first N games")
    args = ap.parse_args()

    rows_by_seed: dict[int, dict[int, dict]] = {}
    n_rows = n_dup = 0
    seen = set()
    for path in sorted(glob.glob(args.twins)):
        for line in open(path):
            r = json.loads(line)
            n_rows += 1
            k = (r["seed"], r["hn"], r["dec"], r["dev"])
            if k in seen:
                n_dup += 1
                continue
            seen.add(k)
            rows_by_seed.setdefault(r["seed"], {}) \
                .setdefault(r["dec"], []).append(r)
    seeds = sorted(rows_by_seed)
    if args.limit_games:
        seeds = seeds[:args.limit_games]
    print(f"{n_rows} rows -> {len(seen)} unique ({n_dup} dupes dropped), "
          f"{len(seeds)} games to replay, feat_dim={FEAT_DIM}", flush=True)

    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    chunks = [seeds[w::args.workers] for w in range(args.workers)]
    procs = [ctx.Process(target=worker,
                         args=(w, args, chunks[w], rows_by_seed))
             for w in range(args.workers)]
    for p in procs:
        p.start()
    for p in procs:
        p.join()

    parts = [np.load(f"{args.out}.w{w}.npz") for w in range(args.workers)]
    merged = {k: np.concatenate([p[k] for p in parts])
              for k in parts[0].files if not k.startswith("audit")}
    ok = int(sum(int(p["audit_ok"][0]) for p in parts))
    n = int(sum(int(p["audit_n"][0]) for p in parts))
    np.savez_compressed(args.out, **merged)
    for w in range(args.workers):
        os.remove(f"{args.out}.w{w}.npz")
    print(f"EXTRACT DONE: {len(merged['dwp'])} examples, "
          f"replay audit {ok}/{n} ok "
          f"({100 * (n - ok) / max(n, 1):.2f}% dropped)", flush=True)


if __name__ == "__main__":
    main()
