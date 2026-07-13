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


def widen(donor_path: str, factor: int = 2, noise: float = 1e-4,
          belief: bool = True) -> "QNet":
    """Net2WiderNet (gen15): grow every hidden layer by `factor` while
    computing the same function — each unit is duplicated, its incoming
    weights copied (plus tiny noise so twins don't stay locked in identical
    gradients forever) and its outgoing weights split evenly among the
    copies. A fresh zero-init belief head rides on the widened trunk;
    since it feeds nothing back into the Q path, play is untouched until
    training decides otherwise."""
    from .model import load_qnet
    from .encoder import ACTION_DIM
    donor = load_qnet(donor_path)
    lins = [m for m in donor.net if isinstance(m, torch.nn.Linear)]
    hidden = tuple(lin.out_features * factor for lin in lins[:-1])
    state_dim = lins[0].in_features - ACTION_DIM
    net = QNet(hidden=hidden, state_dim=state_dim, belief=belief)
    new_lins = [m for m in net.net if isinstance(m, torch.nn.Linear)]

    g = torch.Generator().manual_seed(7)
    with torch.no_grad():
        for i, (old, new) in enumerate(zip(lins, new_lins)):
            w, b = old.weight, old.bias
            if i > 0:  # incoming side was widened: split columns evenly
                w = w.repeat(1, factor) / factor
            if i < len(lins) - 1:  # this layer's units get duplicated
                w = w.repeat(factor, 1)
                w += noise * torch.randn(w.shape, generator=g)
                b = b.repeat(factor)
            new.weight.copy_(w)
            new.bias.copy_(b)
        if belief:
            net.belief_head.weight.zero_()
            net.belief_head.bias.zero_()
    net.eval()
    return net


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--donor", default="models/gen10.pt")
    ap.add_argument("--out", required=True)
    ap.add_argument("--widen", type=int, default=0,
                    help="Net2Wider factor (gen15); 0 = the gen13-style "
                         "belief-input graft instead")
    ap.add_argument("--no-belief-head", action="store_true")
    args = ap.parse_args()
    if args.widen:
        net = widen(args.donor, factor=args.widen,
                    belief=not args.no_belief_head)
        what = f"widened x{args.widen}" + (
            "" if args.no_belief_head else " + belief head")
    else:
        net = graft(args.donor)
        what = f"belief-input graft {STATE_DIM} -> {STATE_DIM_V2}"
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"model": net.state_dict()}, out)
    n = sum(p.numel() for p in net.parameters())
    print(f"{what}: {args.donor} -> {out} ({n:,} params)")


if __name__ == "__main__":
    main()
