"""belief25 — the imagination upgrade, take two, with Riley's weighting.

Same proven pipeline as belief24 (frozen gen23 trunk, fresh belief head,
v4 bid-conditioned inputs, hindsight in labels never inputs) with three
changes that are the whole point:

1. NEW-ERA CORPUS: mills the anytime-assembly action dumps
   (runs/belief/*_acts.jsonl — duel --dump-actions records, replay-
   verified) instead of the gen23-era t0 corpus. The organ studies the
   game as the new stack actually plays it, BidBot auctions included.
2. COUNTER-WEIGHTED LOSS (Riley's law, 2026-08-08): "focus your
   imagination on the count cards." Errors on the twelve counters (the
   5, 10, 13 of each suit — 25 points per color, 100 in the deck) cost
   --counter-weight x more than errors on filler. The organ spends its
   capacity where the points live.
3. THE COUNTER GAUGE: eval reports counter-card placement accuracy
   separately, by trick, for gen23-belief24 vs belief25. No organ goes
   near a fleet gate without beating the incumbent on counters first —
   gauges before gates.

    ~/torch-env/bin/python -m alpharook.belief25 mill --workers 8
    ~/torch-env/bin/python -m alpharook.belief25 train
    ~/torch-env/bin/python -m alpharook.belief25 eval
"""

from __future__ import annotations

import argparse
import glob
import os

import numpy as np
import torch
import torch.nn as nn

from rook.cards import CARD_POINTS
from .belief24 import (
    _load_shards, iter_corpus, masked_acc, mill as mill24, rows_from_game,
)
from .encoder import STATE_DIM_V4
from .model import QNet, load_qnet

SHARD_DIR = "runs/belief25/shards"
MODEL_OUT = "models/belief25.pt"
CORPUS_GLOB = "runs/belief/*_acts.jsonl"

COUNTER = torch.tensor([1.0 if CARD_POINTS[c] > 0 else 0.0
                        for c in range(40)])


def card_weights(counter_weight: float) -> torch.Tensor:
    return 1.0 + (counter_weight - 1.0) * COUNTER      # [40]


def train(args) -> None:
    shards = sorted(glob.glob(os.path.join(args.shards, "*.npz")))
    if len(shards) < 4:
        raise SystemExit(f"only {len(shards)} shards — mill more first")
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
    w40 = card_weights(args.counter_weight).to(dev)     # [40]

    Sv, Av, Tv, Mv, _ = _load_shards(val_p)
    Sv = torch.from_numpy(Sv.astype(np.float32)).to(dev)
    Av = torch.from_numpy(Av.astype(np.float32)).to(dev)
    Tv = torch.from_numpy(Tv.astype(np.int64)).to(dev)
    Mv = torch.from_numpy(Mv).to(dev)
    cm = (COUNTER.to(dev) > 0)
    print(f"{len(tr_p)} train shards, val rows {len(Tv):,}, "
          f"counter weight x{args.counter_weight}", flush=True)

    import random
    import time
    rng = random.Random(25)
    step, best, t0 = 0, 0.0, time.time()
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
                w = (mb * w40.unsqueeze(0)).reshape(-1)      # mask x card wt
                l = (l * w).sum() / w.sum().clamp(min=1)
                opt.zero_grad()
                l.backward()
                opt.step()
                step += 1
            if step % 200 < len(T) // args.batch + 1:
                with torch.no_grad():
                    lg = net.belief_forward(Sv, Av)
                    acc = masked_acc(lg, Tv, Mv)
                    cacc = masked_acc(lg[:, cm], Tv[:, cm], Mv[:, cm])
                print(f"  epoch {epoch} step {step}: val acc {acc:.1%}  "
                      f"COUNTERS {cacc:.1%} ({time.time() - t0:.0f}s)",
                      flush=True)
                if cacc > best:                  # counters pick the winner
                    best = cacc
                    torch.save(net.state_dict(), args.out)
    print(f"best counter acc {best:.1%} -> {args.out}", flush=True)


def evaluate(args) -> None:
    shards = sorted(glob.glob(os.path.join(args.shards, "*.npz")))[-2:]
    S, A, T, M, K = _load_shards(shards)
    S = torch.from_numpy(S.astype(np.float32))
    A = torch.from_numpy(A.astype(np.float32))
    T = torch.from_numpy(T.astype(np.int64))
    M = torch.from_numpy(M)
    cm = COUNTER > 0
    for label, path in (("gen23-belief24", "models/gen23-belief24.pt"),
                        ("belief25", args.brain)):
        if not os.path.exists(path):
            print(f"{label}: {path} missing, skipped")
            continue
        net = load_qnet(path)
        if net.belief_head is None or \
                net.net[0].in_features != S.shape[1] + A.shape[1]:
            print(f"{label}: not a v4 belief net, skipped")
            continue
        with torch.no_grad():
            lg = net.belief_forward(S, A)
            acc = masked_acc(lg, T, M)
            cacc = masked_acc(lg[:, cm], T[:, cm], M[:, cm])
            facc = masked_acc(lg[:, ~cm], T[:, ~cm], M[:, ~cm])
        print(f"{label}: all {acc:.1%} | COUNTERS {cacc:.1%} | "
              f"filler {facc:.1%}")
        for lo, hi, tag in ((-1, -1, "auction/widow"), (0, 2, "tricks 1-3"),
                            (3, 5, "tricks 4-6"), (6, 8, "tricks 7-9")):
            sel = torch.from_numpy((K >= lo) & (K <= hi))
            if sel.sum() < 100:
                continue
            with torch.no_grad():
                lg2 = net.belief_forward(S[sel], A[sel])
                c2 = masked_acc(lg2[:, cm], T[sel][:, cm], M[sel][:, cm])
            print(f"    {tag}: counters {c2:.1%}")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    mp_ = sub.add_parser("mill")
    mp_.add_argument("--corpus", default=CORPUS_GLOB)
    mp_.add_argument("--out", default=SHARD_DIR)
    mp_.add_argument("--games", type=int, default=8000)
    mp_.add_argument("--workers", type=int, default=8)
    tp = sub.add_parser("train")
    tp.add_argument("--shards", default=SHARD_DIR)
    tp.add_argument("--donor", default="models/gen23-cand1.pt")
    tp.add_argument("--out", default=MODEL_OUT)
    tp.add_argument("--epochs", type=int, default=2)
    tp.add_argument("--batch", type=int, default=4096)
    tp.add_argument("--lr", type=float, default=1e-3)
    tp.add_argument("--counter-weight", type=float, default=3.0)
    ep = sub.add_parser("eval")
    ep.add_argument("--shards", default=SHARD_DIR)
    ep.add_argument("--brain", default=MODEL_OUT)
    args = ap.parse_args()
    {"mill": mill24, "train": train, "eval": evaluate}[args.cmd](args)


if __name__ == "__main__":
    main()
