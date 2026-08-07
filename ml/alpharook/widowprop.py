"""WidowProposer — the AlphaZero loop closed on the widow.

MortalWidow's search generates valued burial menus (widowtwin
--label-rows); this net learns to RANK them from the same full-view,
leak-tested state the searcher sees. In production it proposes a
shortlist of ~4; the Calculator still verifies with real worlds before
anything overrides. Instinct proposes, Calculator disposes.

Why this succeeds where WidowBrain (0/2) failed: the reflex nets had to
BE RIGHT at #1 to replace the decision. A proposer only needs the true
best burial inside its top-k — recall, not precision — and the searcher
absorbs the rest. And the training signal here is the searcher's own
VALUED menu (world-mean per candidate), not a single hindsight label.

Grading (the mimic-pilot law): recall@k on the DISAGREEMENT contracts —
the ones where search beat reflex — not global recall, which the
incumbent-heavy distribution flatters.

    ~/torch-env/bin/python -m alpharook.widowprop --data runs/p13/labeled \
        --epochs 20 --out models/widowprop-v0.pt
"""

from __future__ import annotations

import argparse
import glob
import json
import math
import os
import random

import numpy as np
import torch
import torch.nn as nn

D_CAND = 45     # 40 burial mask + 4 trump one-hot + buried counter pts/20


def cand_features(disc, trump):
    x = np.zeros(D_CAND, dtype=np.float32)
    pts = 0
    for c in disc:
        x[c] = 1.0
        pts += 5 if c % 10 == 0 else (10 if c % 10 in (5, 8) else 0)
    x[40 + trump] = 1.0
    x[44] = pts / 20.0
    return x


class WidowProp(nn.Module):
    def __init__(self, d_state: int):
        super().__init__()
        self.d_state = d_state
        self.net = nn.Sequential(
            nn.Linear(d_state + D_CAND, 256), nn.ReLU(),
            nn.Linear(256, 128), nn.ReLU(),
            nn.Linear(128, 1))

    def forward(self, s, c):
        return self.net(torch.cat([s, c], dim=-1)).squeeze(-1)

    def rank(self, state_np, cands):
        """Scores for [(disc, trump), ...] — higher = better burial."""
        with torch.no_grad():
            n = len(cands)
            S = torch.from_numpy(np.stack([state_np] * n)).float()
            C = torch.from_numpy(np.stack(
                [cand_features(d, t) for d, t in cands]))
            return self(S, C).numpy()


def load_rows(data_dir: str):
    rows = []
    for p in sorted(glob.glob(os.path.join(data_dir, "*_w*.jsonl"))):
        for line in open(p):
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if "state" in r and "cand_means" in r \
                    and all(m[2] is not None for m in r["cand_means"]) \
                    and len(r["cand_means"]) >= 2:
                rows.append(r)
    return rows


def to_tensors(rows):
    S, C, V, group = [], [], [], []
    for gi, r in enumerate(rows):
        s = np.asarray(r["state"], dtype=np.float32)
        vals = [m[2] for m in r["cand_means"]]
        mu = sum(vals) / len(vals)
        sd = (sum((v - mu) ** 2 for v in vals) / len(vals)) ** 0.5 or 1.0
        for disc, trump, v in r["cand_means"]:
            S.append(s)
            C.append(cand_features(disc, trump))
            V.append((v - mu) / sd)     # within-contract centered target
            group.append(gi)
    return (torch.from_numpy(np.stack(S)), torch.from_numpy(np.stack(C)),
            torch.tensor(V, dtype=torch.float32), group)


def recall_at(model, rows, ks=(1, 3, 4)):
    """Does the search's own pick land in the proposer's top-k of the
    same menu? Reported overall and on disagreement contracts."""
    hits = {k: [0, 0] for k in ks}       # k -> [all, disagreements]
    n_all = n_dis = 0
    for r in rows:
        cands = [(tuple(m[0]), m[1]) for m in r["cand_means"]]
        vals = [m[2] for m in r["cand_means"]]
        target = int(np.argmax(vals))
        s = np.asarray(r["state"], dtype=np.float32)
        scores = model.rank(s, cands)
        order = list(np.argsort(-scores))
        dis = not r["agree"]
        n_all += 1
        n_dis += int(dis)
        for k in ks:
            if target in order[:k]:
                hits[k][0] += 1
                if dis:
                    hits[k][1] += 1
    out = {}
    for k in ks:
        out[f"r@{k}"] = hits[k][0] / max(1, n_all)
        out[f"r@{k}_dis"] = hits[k][1] / max(1, n_dis)
    out["n"], out["n_dis"] = n_all, n_dis
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="runs/p13/labeled")
    ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--batch", type=int, default=4096)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--holdout", type=float, default=0.1)
    ap.add_argument("--out", default="models/widowprop-v0.pt")
    args = ap.parse_args()

    rows = load_rows(args.data)
    print(f"{len(rows):,} labeled contracts "
          f"({sum(1 for r in rows if not r['agree']):,} disagreements)")
    rng = random.Random(13)
    rng.shuffle(rows)
    n_hold = max(200, int(len(rows) * args.holdout))
    hold, train = rows[:n_hold], rows[n_hold:]
    S, C, V, _ = to_tensors(train)
    d_state = S.shape[1]
    model = WidowProp(d_state)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    n = len(V)
    for ep in range(args.epochs):
        perm = torch.randperm(n)
        tot = 0.0
        for i in range(0, n, args.batch):
            idx = perm[i:i + args.batch]
            loss = nn.functional.mse_loss(model(S[idx], C[idx]), V[idx])
            opt.zero_grad()
            loss.backward()
            opt.step()
            tot += float(loss) * len(idx)
        if ep % 5 == 4 or ep == args.epochs - 1:
            r = recall_at(model, hold)
            print(f"ep {ep + 1}: mse {tot / n:.4f} | held-out "
                  f"r@1 {r['r@1']:.1%} r@4 {r['r@4']:.1%} | "
                  f"DISAGREE r@1 {r['r@1_dis']:.1%} "
                  f"r@3 {r['r@3_dis']:.1%} r@4 {r['r@4_dis']:.1%} "
                  f"(n={r['n']}, dis={r['n_dis']})", flush=True)
    torch.save({"state_dict": model.state_dict(), "d_state": d_state},
               args.out)
    print(f"saved -> {args.out}")


if __name__ == "__main__":
    main()
