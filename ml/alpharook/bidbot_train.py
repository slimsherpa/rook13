"""P2 — BidBot: the full-view bid net, trained on twin-game labels.

Two heads, one small trunk, no hand-written rules:

  * u-head (the decision): u[a] for each of the 13 bid actions, in
    winprob currency. Twin rows label DIFFERENCES — the loss is
    (u[dev] - u[house] - dwp)^2 — so the net learns relative action
    values exactly where the data measured them.
  * s-head (the daydream): predicted my-team hand score for each action.
    Auxiliary only — it regularizes the trunk on thin data and gives the
    UI an honest "expects to make ~120" readout. Never consulted for the
    decision.

Deployment contract (the humility switch): BidBot overrides the house
bid only where max_legal u - u[house] clears the calibration bar tau,
chosen on held-out games so that claimed swings are real (sign holds,
CI clear of zero). Where its opinion is a wash, the house bid stands.

Split is BY GAME (seed % 10 == 0 -> held-out): 18.5 rows share a game,
row-level splits would leak.

    ~/torch-env/bin/python -m alpharook.bidbot_train \
        --data runs/p2/bidbot_train.npz --out models/bidbot-v0.pt
"""

from __future__ import annotations

import argparse
import json

import numpy as np
import torch
import torch.nn as nn

from .bidbot_features import ACTIONS, FEAT_DIM

N_ACTIONS = len(ACTIONS)
SCORE_SCALE = 180.0


class BidNet(nn.Module):
    def __init__(self, in_dim: int = FEAT_DIM,
                 hidden: tuple[int, ...] = (256, 128)):
        super().__init__()
        layers: list[nn.Module] = []
        d = in_dim
        for h in hidden:
            layers += [nn.Linear(d, h), nn.ReLU()]
            d = h
        self.trunk = nn.Sequential(*layers)
        self.u_head = nn.Linear(d, N_ACTIONS)   # relative winprob values
        self.s_head = nn.Linear(d, N_ACTIONS)   # daydream: hand score /180

    def forward(self, x: torch.Tensor):
        h = self.trunk(x)
        return self.u_head(h), self.s_head(h)


def load_split(path: str, frac: float = 1.0):
    d = np.load(path)
    val = d["seed"] % 10 == 0
    tr = ~val
    if frac < 1.0:
        keep_seeds = np.unique(d["seed"][tr])
        keep_seeds = keep_seeds[: int(len(keep_seeds) * frac)]
        tr = tr & np.isin(d["seed"], keep_seeds)
    def take(m):
        return {k: torch.from_numpy(np.ascontiguousarray(d[k][m]))
                for k in ("x", "house_i", "dev_i", "dwp", "my_a", "my_b",
                          "mask")}
    return take(tr), take(val)


def batch_loss(net, b, aux: float):
    u, s = net(b["x"])
    idx_h = b["house_i"].long().unsqueeze(1)
    idx_d = b["dev_i"].long().unsqueeze(1)
    u_h = u.gather(1, idx_h).squeeze(1)
    u_d = u.gather(1, idx_d).squeeze(1)
    l_dwp = ((u_d - u_h - b["dwp"]) ** 2).mean()
    s_h = s.gather(1, idx_h).squeeze(1)
    s_d = s.gather(1, idx_d).squeeze(1)
    l_s = (((s_h - b["my_a"] / SCORE_SCALE) ** 2).mean()
           + ((s_d - b["my_b"] / SCORE_SCALE) ** 2).mean())
    return l_dwp + aux * l_s, l_dwp


@torch.no_grad()
def calibrate(net, val, taus=(0.02, 0.03, 0.05, 0.08, 0.12)):
    """Held-out honesty: among rows where the net claims |swing| > tau
    for the recorded deviation, is the realized dwp on its side?"""
    u, _ = net(val["x"])
    pred = (u.gather(1, val["dev_i"].long().unsqueeze(1)).squeeze(1)
            - u.gather(1, val["house_i"].long().unsqueeze(1)).squeeze(1))
    real = val["dwp"]
    base = float((real ** 2).mean())
    mse = float(((pred - real) ** 2).mean())
    rows = []
    for tau in taus:
        m = pred.abs() > tau
        n = int(m.sum())
        if n == 0:
            rows.append(dict(tau=tau, n=0))
            continue
        aligned = real[m] * pred[m].sign()
        mean = float(aligned.mean())
        sem = float(aligned.std() / max(n, 2) ** 0.5)
        rows.append(dict(tau=tau, n=n, frac=n / len(real),
                         sign_acc=float((aligned > 0).float().mean()),
                         realized=mean, sem=sem, ci_clear=mean - 2 * sem > 0))
    # override rate at the house decision: best LEGAL alternative vs house
    mask = val["mask"].long()
    legal = torch.stack([(mask >> i) & 1 for i in range(N_ACTIONS)], 1).bool()
    u_masked = u.masked_fill(~legal, -1e9)
    delta = (u_masked.max(1).values
             - u.gather(1, val["house_i"].long().unsqueeze(1)).squeeze(1))
    return dict(val_mse=mse, zero_mse=base,
                skill=1 - mse / base, taus=rows,
                override_frac={f"{t:.2f}": float((delta > t).float().mean())
                               for t in taus})


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="runs/p2/bidbot_train.npz")
    ap.add_argument("--out", default="models/bidbot-v0.pt")
    ap.add_argument("--frac", type=float, default=1.0,
                    help="learning curve: fraction of training GAMES")
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--bs", type=int, default=512)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--aux", type=float, default=0.5)
    ap.add_argument("--seed", type=int, default=13)
    args = ap.parse_args()
    torch.manual_seed(args.seed)

    tr, val = load_split(args.data, args.frac)
    n = len(tr["dwp"])
    print(f"train {n} rows / val {len(val['dwp'])} rows "
          f"(frac={args.frac})", flush=True)
    net = BidNet()
    opt = torch.optim.AdamW(net.parameters(), lr=args.lr, weight_decay=1e-4)
    best = (1e9, None)
    patience = 0
    for ep in range(args.epochs):
        net.train()
        perm = torch.randperm(n)
        tot = 0.0
        for i in range(0, n, args.bs):
            b = {k: v[perm[i:i + args.bs]] for k, v in tr.items()}
            loss, l_dwp = batch_loss(net, b, args.aux)
            opt.zero_grad()
            loss.backward()
            opt.step()
            tot += float(l_dwp) * len(b["dwp"])
        net.eval()
        with torch.no_grad():
            _, vloss = batch_loss(net, val, args.aux)
        vloss = float(vloss)
        print(f"  ep {ep + 1}: train {tot / n:.5f}  val {vloss:.5f}",
              flush=True)
        if vloss < best[0] - 1e-5:
            best = (vloss, {k: v.clone() for k, v in net.state_dict().items()})
            patience = 0
        else:
            patience += 1
            if patience >= 5:
                break
    net.load_state_dict(best[1])
    net.eval()
    report = calibrate(net, val)
    report["train_rows"] = n
    report["frac"] = args.frac
    print(json.dumps(report, indent=1), flush=True)
    if args.frac == 1.0:
        torch.save(dict(model=net.state_dict(), in_dim=FEAT_DIM,
                        actions=list(ACTIONS), report=report), args.out)
        print(f"saved {args.out}", flush=True)


if __name__ == "__main__":
    main()
