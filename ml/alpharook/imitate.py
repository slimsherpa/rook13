"""Behavior-cloning warm start: teach the QNet to imitate the family
heuristic's card play before Deep Monte Carlo improves on it.

DMC from a random net spends its whole budget rediscovering what bots.ts
already knows (gen5: ~8% play-strength after 2000+ iters, decelerating).
Cloning first drops the net near Standard's level, and DMC fine-tunes from
there — the AlphaGo recipe (SL policy -> RL policy), scaled to a MacBook.

The Q(s,a) net is trained as a classifier here: its values over the legal
candidates are treated as logits and cross-entropied against the heuristic's
chosen card. That makes argmax match the teacher; DMC's MSE then re-anchors
the values to real returns without losing the ranking.

Usage:
    python -m alpharook.imitate --games 4000 --out runs/bc.pt
    python -m alpharook.train --run gen6 --play-only --init-from runs/bc.pt ...
"""

from __future__ import annotations

import argparse
import random
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch

from rook.bots import next_bot_action
from rook.observation import observe
from .encoder import (
    encode_state, encode_action, D_BID, D_DISCARD, D_TRUMP, D_PLAY,
)
from .env import SelfPlayGame
from .model import QNet

DTYPE_BY_NAME = {"bid": D_BID, "discard": D_DISCARD, "trump": D_TRUMP,
                 "play": D_PLAY}


def generate(n_games: int, seed: int = 0, style: str = "basic",
             dtypes: frozenset = frozenset({D_PLAY})):
    """All-heuristic games; every decision of a requested type (for every
    seat) becomes one classification example: (state, K candidates,
    teacher's pick). Go-down discards are recorded pick-by-pick."""
    rng = random.Random(seed)
    # K -> (state, K action vecs, positives multi-hot over the K candidates)
    by_k: dict[int, list] = defaultdict(list)
    decisions = 0

    def record(env, seat, dtype, cands, positives):
        nonlocal decisions
        if dtype in dtypes and len(cands) > 1:
            s = encode_state(observe(env.g, seat), env.picks, dtype, env.g)
            acts = np.stack([encode_action(dtype, a) for a in cands])
            pos = np.zeros(len(cands), dtype=np.float32)
            for p in positives:
                pos[cands.index(p)] = 1.0
            by_k[len(cands)].append((s, acts, pos))
            decisions += 1

    for gi in range(n_games):
        env = SelfPlayGame(seed * 1_000_003 + gi)
        styles = [style] * 4
        pending: list[int] = []
        while not env.done:
            seat, dtype, cands = env.decision()
            if dtype == D_DISCARD:
                if not pending:
                    _, _, cards = next_bot_action(env.g, styles, rng)
                    pending = list(cards)
                # a go-down is a SET: every not-yet-picked teacher card is an
                # equally correct next pick (order-invariant labels — labeling
                # the teacher's arbitrary pick order costs ~70 points of
                # teacher-match on discards)
                positives = list(pending)
                action = pending.pop(0)
            else:
                _, _, action = next_bot_action(env.g, styles, rng)
                positives = [action]
            record(env, seat, dtype, cands, positives)
            env.apply(action)
    return by_k, decisions


def train_bc(by_k, epochs: int, lr: float, batch_size: int, device: str,
             net: QNet | None = None) -> tuple[QNet, float]:
    net = net or QNet()
    net.to(device).train()
    opt = torch.optim.Adam(net.parameters(), lr=lr)

    # bucket by candidate count so each batch is a clean (B, K) classification
    buckets = {}
    for k, rows in by_k.items():
        S = torch.from_numpy(np.stack([r[0] for r in rows]))
        A = torch.from_numpy(np.stack([r[1] for r in rows]))  # (N, K, act)
        P = torch.from_numpy(np.stack([r[2] for r in rows]))  # (N, K) multi-hot
        buckets[k] = (S, A, P)

    last_acc = 0.0
    for ep in range(epochs):
        correct = total = 0
        for k, (S, A, P) in buckets.items():
            n = len(P)
            perm = torch.randperm(n)
            for i in range(0, n, batch_size):
                idx = perm[i:i + batch_size]
                s = S[idx].to(device)
                a = A[idx].to(device)
                p = P[idx].to(device)
                b = len(idx)
                s_rep = s.unsqueeze(1).expand(-1, k, -1).reshape(b * k, -1)
                logits = net(s_rep, a.reshape(b * k, -1)).view(b, k)
                # multi-positive cross-entropy: -log P(any correct candidate)
                masked = logits.masked_fill(p == 0, -1e9)
                loss = (torch.logsumexp(logits, 1)
                        - torch.logsumexp(masked, 1)).mean()
                opt.zero_grad()
                loss.backward()
                opt.step()
                hit = p.gather(1, logits.argmax(1, keepdim=True)).squeeze(1)
                correct += (hit > 0).sum().item()
                total += b
        last_acc = correct / total
        print(f"  epoch {ep}: teacher-match {last_acc:.1%}")
    return net, last_acc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=4000)
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--batch-size", type=int, default=512)
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--style", default="basic")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--dtypes", default="play",
                    help="comma list of decision types to clone: "
                         "play,discard,trump")
    ap.add_argument("--init-from", default=None,
                    help="start from existing weights (e.g. a DMC checkpoint) "
                         "instead of a fresh net")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parents[1]
                                         / "runs" / "bc.pt"))
    args = ap.parse_args()

    dtypes = frozenset(DTYPE_BY_NAME[d.strip()] for d in args.dtypes.split(","))
    net = None
    if args.init_from:
        net = QNet()
        ck = torch.load(args.init_from, map_location="cpu", weights_only=True)
        net.load_state_dict(ck["model"] if "model" in ck else ck)
        print(f"initialized from {args.init_from}")

    t0 = time.time()
    by_k, n = generate(args.games, args.seed, args.style, dtypes)
    print(f"generated {n} decisions ({args.dtypes}) from {args.games} games "
          f"in {time.time() - t0:.0f}s")
    net, acc = train_bc(by_k, args.epochs, args.lr, args.batch_size,
                        args.device, net)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    torch.save({"model": net.state_dict(), "bc_acc": acc,
                "games": args.games}, args.out)
    print(f"saved {args.out} (teacher-match {acc:.1%})")


if __name__ == "__main__":
    main()
