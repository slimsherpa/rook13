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
from .encoder import encode_state, encode_action, D_DISCARD, D_PLAY
from .env import SelfPlayGame
from .model import QNet


def generate(n_games: int, seed: int = 0, style: str = "basic"):
    """All-heuristic games; every PLAY decision of every seat becomes one
    classification example: (state, K candidate actions, teacher's pick)."""
    rng = random.Random(seed)
    by_k: dict[int, list] = defaultdict(list)  # K -> (state, K action vecs, label)
    decisions = 0
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
                env.apply(pending.pop(0))
                continue
            _, _, action = next_bot_action(env.g, styles, rng)
            if dtype == D_PLAY and len(cands) > 1:
                s = encode_state(observe(env.g, seat), env.picks, dtype, env.g)
                acts = np.stack([encode_action(dtype, a) for a in cands])
                by_k[len(cands)].append((s, acts, cands.index(action)))
                decisions += 1
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
        Y = torch.tensor([r[2] for r in rows])
        buckets[k] = (S, A, Y)

    last_acc = 0.0
    for ep in range(epochs):
        correct = total = 0
        for k, (S, A, Y) in buckets.items():
            n = len(Y)
            perm = torch.randperm(n)
            for i in range(0, n, batch_size):
                idx = perm[i:i + batch_size]
                s = S[idx].to(device)
                a = A[idx].to(device)
                y = Y[idx].to(device)
                b = len(idx)
                s_rep = s.unsqueeze(1).expand(-1, k, -1).reshape(b * k, -1)
                logits = net(s_rep, a.reshape(b * k, -1)).view(b, k)
                loss = torch.nn.functional.cross_entropy(logits, y)
                opt.zero_grad()
                loss.backward()
                opt.step()
                correct += (logits.argmax(1) == y).sum().item()
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
    ap.add_argument("--out", default=str(Path(__file__).resolve().parents[1]
                                         / "runs" / "bc.pt"))
    args = ap.parse_args()

    t0 = time.time()
    by_k, n = generate(args.games, args.seed, args.style)
    print(f"generated {n} play decisions from {args.games} games "
          f"in {time.time() - t0:.0f}s")
    net, acc = train_bc(by_k, args.epochs, args.lr, args.batch_size, args.device)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    torch.save({"model": net.state_dict(), "bc_acc": acc,
                "games": args.games}, args.out)
    print(f"saved {args.out} (teacher-match {acc:.1%})")


if __name__ == "__main__":
    main()
