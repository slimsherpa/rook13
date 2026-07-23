"""The bidding gym's world: P(declarer points | dealt 9, widow).

Trained on millions of real reflex-played hands (gen_bid_data.py). Output
is a DISTRIBUTION over 25 point-buckets (0..120 step 5) and the gym
SAMPLES from it — the variance is the lesson: a bid is a bet against the
spread of outcomes, and set-risk only exists if bad draws stay possible.

    python -m alpharook.outcome_model --data runs/biddata --out models/outcome.pt
"""

from __future__ import annotations

import argparse
import glob
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

N_BUCKETS = 25  # declarer points 0..120 in steps of 5
IN_DIM = 80     # dealt 9 multihot(40) + widow multihot(40)


class OutcomeNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(IN_DIM, 128), nn.ReLU(),
            nn.Linear(128, 128), nn.ReLU(),
            nn.Linear(128, N_BUCKETS),
        )

    def forward(self, x):
        return self.net(x)

    @torch.no_grad()
    def sample_points(self, dealt: list[int], widow: list[int], rng) -> float:
        """rng is a stdlib random.Random — one sampler everywhere."""
        x = encode_deal(dealt, widow)
        p = torch.softmax(self(torch.from_numpy(x).unsqueeze(0))[0], -1)
        b = rng.choices(range(N_BUCKETS), weights=p.tolist())[0]
        return 5.0 * b


def encode_deal(dealt, widow) -> np.ndarray:
    x = np.zeros(IN_DIM, dtype=np.float32)
    for c in dealt:
        x[c] = 1.0
    for c in widow:
        x[40 + c] = 1.0
    return x


def load_outcome(path: str) -> OutcomeNet:
    net = OutcomeNet()
    ck = torch.load(path, map_location="cpu", weights_only=True)
    net.load_state_dict(ck["model"] if "model" in ck else ck)
    net.eval()
    return net


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="runs/biddata")
    ap.add_argument("--out", default="models/outcome.pt")
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--max-rows", type=int, default=6_000_000)
    args = ap.parse_args()

    X, Y = [], []
    for f in sorted(glob.glob(f"{args.data}/*.jsonl")):
        for line in open(f):
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue  # partial tail line from a live generator
            if not r.get("dealt"):
                continue
            X.append(encode_deal(r["dealt"], r["widow"]))
            Y.append(min(N_BUCKETS - 1, int(round(r["decl_pts"] / 5.0))))
            if len(Y) >= args.max_rows:
                break
        if len(Y) >= args.max_rows:
            break
    X = torch.from_numpy(np.stack(X))
    Y = torch.tensor(Y, dtype=torch.long)
    n = len(Y)
    hold = n // 20
    perm = torch.randperm(n)
    X, Y = X[perm], Y[perm]
    Xtr, Ytr, Xho, Yho = X[hold:], Y[hold:], X[:hold], Y[:hold]
    print(f"{n:,} hands ({hold:,} held out)")

    net = OutcomeNet()
    opt = torch.optim.Adam(net.parameters(), lr=1e-3)
    for ep in range(args.epochs):
        net.train()
        p = torch.randperm(len(Ytr))
        tot = 0.0
        for i in range(0, len(Ytr), 4096):
            idx = p[i:i + 4096]
            loss = nn.functional.cross_entropy(net(Xtr[idx]), Ytr[idx])
            opt.zero_grad(); loss.backward(); opt.step()
            tot += loss.item() * len(idx)
        net.eval()
        with torch.no_grad():
            ho = nn.functional.cross_entropy(net(Xho), Yho).item()
            probs = torch.softmax(net(Xho), -1)
            pred_mean = (probs * torch.arange(N_BUCKETS)).sum(-1) * 5
            mae = (pred_mean - Yho.float() * 5).abs().mean().item()
        print(f"epoch {ep}: train CE {tot / len(Ytr):.4f}  holdout CE {ho:.4f}  "
              f"mean-pts MAE {mae:.1f}")
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    torch.save({"model": net.state_dict()}, args.out)
    print(f"saved {args.out}")


if __name__ == "__main__":
    main()
