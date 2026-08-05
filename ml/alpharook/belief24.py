"""belief24 — T1 of the gen24 campaign: retrain the belief organ
(2026-08-02, GEN24-PLAN.md surface 2, t0 upgrade ladder).

The stack's imagination is gen15's belief head — trained two eras ago on
gen13-meta self-play, reading the v2 encoder (no auction transcript, no
dealer sense). This module grows a NEW organ on the gen23 trunk:

- Load models/gen23-cand1.pt into a QNet(belief=True): the Q function
  stays byte-identical (forward() never touches the head); only the
  fresh belief head trains. The saved checkpoint is a drop-in for
  BeliefOracle / duel --belief-ckpt / search — load_qnet already
  auto-detects belief heads from the weights.
- Supervision: replay the banked gen23-era t0 corpus (teacher-vs-gen21
  duel records, runs/t0shards/t0corpus_*.jsonl — raw seed+actions,
  re-millable forever) and stamp selfplay.belief_target at every
  decision: who holds each unseen card, classes rel-seat-1/2/3 or
  hidden widow/go-down. Targets come from the true state; inputs are
  the v4 observation encoding — hindsight in labels, never in inputs.
- Because the input is encoder v4, the new organ is BID-CONDITIONED:
  it can finally use "she opened 105 and partner backed out" when
  placing trump — the named-but-never-pulled lever from the gen16
  notes. The play distribution is teacher+gen21 (both strong), i.e.
  the meta the organ will actually serve.

Gauges, in order: masked accuracy by trick (gen15 banked 44.7%
overall on its own era); world_acc.py world-truth vs the gen15 oracle;
then the stack duel (gen23 x belief24 x t0 vs gen23 x gen15 x t0).

    ~/torch-env/bin/python -m alpharook.belief24 mill --games 8000 --workers 6
    ~/torch-env/bin/python -m alpharook.belief24 train
    ~/torch-env/bin/python -m alpharook.belief24 eval
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import random
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

from rook.observation import observe
from .duel import deck_stream
from .encoder import STATE_DIM_V4, D_PLAY, encode_state_v4, encode_action
from .env import SelfPlayGame
from .model import QNet, load_qnet
from .selfplay import belief_target

SHARD_DIR = "runs/gen24/belief24/shards"
MODEL_OUT = "models/gen23-belief24.pt"
CORPUS_GLOB = "runs/t0shards/t0corpus_*.jsonl"
GAMES_PER_SHARD = 100
PLAY_KEEP = 0.5          # play rows are ~97% of decisions; subsample
VAL_MOD = 50             # seed % 50 == 0 -> validation (mimic convention)


def iter_corpus(paths, want_val: bool | None = None):
    """Yield deduped duel records; want_val None = everything."""
    for p in paths:
        seen = set()
        with open(p) as f:
            for line in f:
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                key = (rec["seed"], rec["flip"])
                if key in seen:
                    continue
                seen.add(key)
                if "win" not in rec:
                    rec["win"], rec["lose"] = \
                        (500, -250) if "std" in Path(p).name else (2000, -1000)
                if want_val is not None and \
                        ((rec["seed"] % VAL_MOD == 0) != want_val):
                    continue
                yield rec


def rows_from_game(rec, rng: random.Random):
    """Replay one duel record; yield (state, action_enc, target, mask,
    trick) at kept decisions from BOTH chairs (the organ serves every
    seat)."""
    seed = rec["seed"]
    env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed),
                       dealer=seed % 4, win_score=rec["win"],
                       lose_score=rec["lose"])
    for d in rec["d"]:
        seat, dtype, action = d[0], d[1], d[2]
        s2, d2, cands = env.decision()
        assert s2 == seat and d2 == dtype, f"replay divergence, seed {seed}"
        if dtype != D_PLAY or rng.random() < PLAY_KEEP:
            t, m = belief_target(env.g, seat)
            if m.any():
                state = encode_state_v4(observe(env.g, seat), env.picks,
                                        dtype, env.g, env.trump_intent)
                yield (state, encode_action(dtype, action), t, m,
                       len(env.g.completed_tricks) if dtype == D_PLAY
                       else -1)
        env.apply(action)


def _mill_worker(worker_id: int, args):
    files = sorted(glob.glob(args.corpus))
    files = files[worker_id::args.workers]
    rng = random.Random(0xB24 ^ worker_id)
    os.makedirs(args.out, exist_ok=True)
    S, A, T, M, K = [], [], [], [], []
    shard_n = games = 0
    t0 = time.time()
    for rec in iter_corpus(files):
        if games >= args.games // args.workers:
            break
        for row in rows_from_game(rec, rng):
            S.append(row[0].astype(np.float16))
            A.append(row[1].astype(np.float16))
            T.append(row[2])
            M.append(row[3])
            K.append(np.int8(row[4]))
        games += 1
        if games % GAMES_PER_SHARD == 0:
            path = os.path.join(args.out, f"w{worker_id}_{shard_n:04d}.npz")
            np.savez_compressed(path + ".tmp.npz", S=np.stack(S),
                                A=np.stack(A), T=np.stack(T),
                                M=np.stack(M), K=np.array(K))
            os.replace(path + ".tmp.npz", path)
            S, A, T, M, K = [], [], [], [], []
            shard_n += 1
            if worker_id == 0:
                print(f"  [w0] {games} games, shard {shard_n}, "
                      f"{games / (time.time() - t0):.1f} games/s", flush=True)
    if S:
        path = os.path.join(args.out, f"w{worker_id}_{shard_n:04d}.npz")
        np.savez_compressed(path + ".tmp.npz", S=np.stack(S), A=np.stack(A),
                            T=np.stack(T), M=np.stack(M), K=np.array(K))
        os.replace(path + ".tmp.npz", path)


def mill(args):
    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    procs = [ctx.Process(target=_mill_worker, args=(w, args))
             for w in range(args.workers)]
    for p in procs:
        p.start()
    print(f"belief24 mill: {args.workers} workers, {args.games} games "
          f"-> {args.out}", flush=True)
    for p in procs:
        p.join()
    print("BELIEF24 MILL DONE", flush=True)


def _load_shards(paths):
    Ss, As, Ts, Ms, Ks = [], [], [], [], []
    for p in paths:
        z = np.load(p)
        Ss.append(z["S"]); As.append(z["A"]); Ts.append(z["T"])
        Ms.append(z["M"]); Ks.append(z["K"])
    return (np.concatenate(Ss), np.concatenate(As), np.concatenate(Ts),
            np.concatenate(Ms), np.concatenate(Ks))


def masked_acc(logits, T, M):
    pred = logits.argmax(-1)
    ok = ((pred == T) & M.bool()).sum().item()
    return ok / max(M.sum().item(), 1)


def train(args):
    shards = sorted(glob.glob(os.path.join(args.shards, "*.npz")))
    if len(shards) < 4:
        raise SystemExit(f"only {len(shards)} shards")
    val_p, tr_p = shards[-2:], shards[:-2]
    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    donor = load_qnet(args.donor)
    net = QNet(hidden=(512, 512, 256), state_dim=STATE_DIM_V4, belief=True)
    missing = net.load_state_dict(donor.state_dict(), strict=False)
    assert not missing.unexpected_keys
    net.to(dev)
    for name, p in net.named_parameters():
        p.requires_grad_(name.startswith("belief_head"))
    opt = torch.optim.Adam(net.belief_head.parameters(), lr=args.lr)
    lossf = nn.CrossEntropyLoss(reduction="none")
    Sv, Av, Tv, Mv, Kv = _load_shards(val_p)
    Sv = torch.from_numpy(Sv.astype(np.float32)).to(dev)
    Av = torch.from_numpy(Av.astype(np.float32)).to(dev)
    Tv = torch.from_numpy(Tv.astype(np.int64)).to(dev)
    Mv = torch.from_numpy(Mv).to(dev)
    print(f"{len(tr_p)} train shards, val rows {len(Tv):,}", flush=True)
    rng = random.Random(11)
    step = 0
    t0 = time.time()
    best = 0.0
    for epoch in range(args.epochs):
        order = list(tr_p)
        rng.shuffle(order)
        for sp in order:
            S, A, T, M, _ = _load_shards([sp])
            idx = np.random.permutation(len(T))
            S, A, T, M = S[idx], A[idx], T[idx], M[idx]
            for k in range(0, len(T), args.batch):
                sb = torch.from_numpy(
                    S[k:k + args.batch].astype(np.float32)).to(dev)
                ab = torch.from_numpy(
                    A[k:k + args.batch].astype(np.float32)).to(dev)
                tb = torch.from_numpy(
                    T[k:k + args.batch].astype(np.int64)).to(dev)
                mb = torch.from_numpy(M[k:k + args.batch]).to(dev)
                logits = net.belief_forward(sb, ab)          # [B,40,4]
                l = lossf(logits.reshape(-1, 4), tb.reshape(-1))
                l = (l * mb.reshape(-1)).sum() / mb.sum().clamp(min=1)
                opt.zero_grad()
                l.backward()
                opt.step()
                step += 1
            if step % 200 < len(T) // args.batch + 1:
                with torch.no_grad():
                    acc = masked_acc(net.belief_forward(Sv, Av), Tv, Mv)
                print(f"  epoch {epoch} step {step}: val masked acc "
                      f"{acc:.1%} ({time.time() - t0:.0f}s)", flush=True)
                if acc > best:
                    best = acc
                    torch.save(net.state_dict(), args.out)
    with torch.no_grad():
        acc = masked_acc(net.belief_forward(Sv, Av), Tv, Mv)
    if acc > best:
        torch.save(net.state_dict(), args.out)
    print(f"final val masked acc {acc:.1%} (best {max(best, acc):.1%}) "
          f"-> {args.out}", flush=True)


def evaluate(args):
    shards = sorted(glob.glob(os.path.join(args.shards, "*.npz")))[-2:]
    S, A, T, M, K = _load_shards(shards)
    dev = "cpu"
    rows = []
    for label, path in (("gen15", "models/gen15.pt"),
                        ("belief24", args.brain)):
        net = load_qnet(path)
        if net.belief_head is None:
            print(f"{label}: no belief head, skipped")
            continue
        accs = {}
        with torch.no_grad():
            for trick in sorted(set(K.tolist())):
                sel = K == trick
                if sel.sum() < 50:
                    continue
                # gen15 is a v2-encoder net: encode_state_for would need the
                # live game; here we compare only v4 nets apples-to-apples
                if net.net[0].in_features != S.shape[1] + A.shape[1]:
                    accs = None
                    break
                lg = net.belief_forward(
                    torch.from_numpy(S[sel].astype(np.float32)),
                    torch.from_numpy(A[sel].astype(np.float32)))
                accs[trick] = masked_acc(lg, torch.from_numpy(
                    T[sel].astype(np.int64)), torch.from_numpy(M[sel]))
        if accs is None:
            print(f"{label}: different encoder (v2) — compare via "
                  f"world_acc.py instead")
            continue
        print(f"{label}:")
        for trick, a in accs.items():
            tag = f"trick {trick}" if trick >= 0 else "auction/widow"
            print(f"  {tag}: {a:.1%}")
        rows.append((label, accs))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    mp_ = sub.add_parser("mill")
    mp_.add_argument("--corpus", default=CORPUS_GLOB)
    mp_.add_argument("--out", default=SHARD_DIR)
    mp_.add_argument("--games", type=int, default=8000)
    mp_.add_argument("--workers", type=int, default=6)
    tp = sub.add_parser("train")
    tp.add_argument("--shards", default=SHARD_DIR)
    tp.add_argument("--donor", default="models/gen23-cand1.pt")
    tp.add_argument("--out", default=MODEL_OUT)
    tp.add_argument("--epochs", type=int, default=2)
    tp.add_argument("--batch", type=int, default=4096)
    tp.add_argument("--lr", type=float, default=1e-3)
    ep = sub.add_parser("eval")
    ep.add_argument("--shards", default=SHARD_DIR)
    ep.add_argument("--brain", default=MODEL_OUT)
    args = ap.parse_args()
    {"mill": mill, "train": train, "eval": evaluate}[args.cmd](args)


if __name__ == "__main__":
    main()
