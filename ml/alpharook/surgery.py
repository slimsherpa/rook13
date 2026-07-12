"""Network surgery: graft the v2 belief inputs onto a trained v1 champion.

The new encoder appends BELIEF_DIM features to the state, so layer one
needs BELIEF_DIM extra input columns. Initializing them to ZERO makes the
enlarged net compute exactly the same function as the donor on every
input — 19.5M games of gen10 knowledge survive intact — and training then
learns how much the belief block matters. (Column order: v1 state block,
new belief block, then the 50 action dims, matching encode_state_v2.)

    python -m alpharook.surgery --donor models/gen10.pt --out runs/gen13/init.pt
"""

from __future__ import annotations

import argparse
from pathlib import Path

import torch

from .encoder import STATE_DIM, STATE_DIM_V2, BELIEF_DIM, ACTION_DIM
from .model import QNet


def graft(donor_path: str) -> QNet:
    ck = torch.load(donor_path, map_location="cpu", weights_only=True)
    sd = dict(ck["model"] if "model" in ck else ck)
    w0 = sd["net.0.weight"]
    assert w0.shape[1] == STATE_DIM + ACTION_DIM, \
        f"donor is not a v1 net (input {w0.shape[1]})"
    out_dim = w0.shape[0]
    new_w0 = torch.zeros(out_dim, STATE_DIM_V2 + ACTION_DIM)
    new_w0[:, :STATE_DIM] = w0[:, :STATE_DIM]              # v1 state block
    new_w0[:, STATE_DIM + BELIEF_DIM:] = w0[:, STATE_DIM:]  # action block
    sd["net.0.weight"] = new_w0

    net = QNet(state_dim=STATE_DIM_V2)
    net.load_state_dict(sd)
    net.eval()
    return net


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--donor", default="models/gen10.pt")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    net = graft(args.donor)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"model": net.state_dict()}, out)
    n = sum(p.numel() for p in net.parameters())
    print(f"grafted {args.donor} -> {out} ({n:,} params, "
          f"state {STATE_DIM} -> {STATE_DIM_V2})")


if __name__ == "__main__":
    main()
