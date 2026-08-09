"""P(win the game | score state at a hand boundary) — the poker brain.

In the -250/+500 format a bid is a wager whose value depends on the score:
100 points is worth almost nothing at 460-100 and everything at 380-460,
and going set for -100 at -160 isn't -100, it's the whole game. Every
oracle EV in gen24 is denominated in THIS currency, not card points.

Fitted as a small logistic on hand-start score states from the gene-gym's
banked league games (runs/gen24/*/hands_s*.jsonl — one row per hand with
scores at the deal and the eventual game winner). The gene cities were
retired after 1,068 seasons; this table is their bequest.

    ~/torch-env/bin/python -m alpharook.winprob        # fit + calibration
    from alpharook.winprob import WinProb; wp = WinProb(); wp(my, opp)
"""

from __future__ import annotations

import glob
import json
import math
import os

COEF_PATH = os.path.join(os.path.dirname(__file__), "..", "models",
                         "winprob24.json")


def _features(my: float, opp: float) -> list[float]:
    d = (my - opp) / 100.0
    return [1.0, d, d * abs(d),
            my / 100.0, opp / 100.0,
            max(0.0, -(my + 130.0)) / 100.0,   # own cliff proximity
            max(0.0, -(opp + 130.0)) / 100.0,  # their cliff proximity
            max(0.0, my - 350.0) / 100.0,      # own closing range
            max(0.0, opp - 350.0) / 100.0]     # their closing range


class WinProb:
    def __init__(self, path: str = COEF_PATH):
        with open(path) as f:
            self.coef = json.load(f)["coef"]

    def __call__(self, my: float, opp: float,
                 win_score: int = 505, lose_score: int = -255) -> float:
        # terminal states first: the engine ends the game on any crossing
        # unless the scores are tied
        if my != opp:
            if my >= win_score or opp <= lose_score:
                return 1.0
            if opp >= win_score or my <= lose_score:
                return 0.0
        z = sum(c * x for c, x in zip(self.coef, _features(my, opp)))
        return 1.0 / (1.0 + math.exp(-z))


def fit(out_dir: str = "runs/gen24", epochs: int = 60, lr: float = 0.5):
    import torch
    xs, ys = [], []
    for path in glob.glob(os.path.join(out_dir, "*", "hands_s*.jsonl")):
        with open(path) as f:
            for line in f:
                try:
                    r = json.loads(line)
                except json.JSONDecodeError:
                    continue
                y = 1.0 if r["w"] == 0 else 0.0
                for h in r["hands"]:
                    s0, s1 = h["scores"]
                    xs.append(_features(s0, s1)); ys.append(y)
                    xs.append(_features(s1, s0)); ys.append(1.0 - y)
    X = torch.tensor(xs); Y = torch.tensor(ys)
    print(f"fitting on {len(ys):,} hand-start score states")
    w = torch.zeros(X.shape[1], requires_grad=True)
    opt = torch.optim.LBFGS([w], lr=lr, max_iter=epochs)

    def closure():
        opt.zero_grad()
        loss = torch.nn.functional.binary_cross_entropy_with_logits(X @ w, Y)
        loss.backward()
        return loss
    opt.step(closure)
    loss = closure().item()
    with open(COEF_PATH, "w") as f:
        json.dump({"coef": w.detach().tolist(), "n": len(ys),
                   "logloss": loss}, f)
    print(f"logloss {loss:.4f} -> {COEF_PATH}")

    # calibration readout: predicted vs actual by bucket
    wp = WinProb()
    P = torch.tensor([wp(*_unfeature(x)) for x in xs[:200000]])
    Yv = Y[:200000]
    print("calibration (pred bucket: actual rate, n):")
    for lo in [0.0, 0.2, 0.4, 0.6, 0.8]:
        m = (P >= lo) & (P < lo + 0.2)
        if m.sum() > 0:
            print(f"  {lo:.1f}-{lo + 0.2:.1f}: {Yv[m].mean():.3f} "
                  f"(n={int(m.sum())})")

    for my, opp in [(0, 0), (250, 250), (430, 270), (270, 430), (460, 460),
                    (-180, 150), (150, -180), (-200, 430), (430, -200),
                    (100, 100), (350, 100)]:
        print(f"  P(win | {my:>4} vs {opp:>4}) = {wp(my, opp):.3f}")


def _unfeature(x):
    return x[3] * 100.0, x[4] * 100.0


if __name__ == "__main__":
    fit()
