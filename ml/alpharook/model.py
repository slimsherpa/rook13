"""The AlphaRook value network: Q(observation, action) -> expected game result.

DouZero-style Deep Monte Carlo: no tree, no bootstrapping — the net regresses
each (state, action) pair against the final outcome of the full game it came
from, and acting is just argmax over the legal candidates. Small enough
(~600k params) to export to ONNX and run live in the browser later.
"""

from __future__ import annotations

import torch
import torch.nn as nn

from .encoder import STATE_DIM, ACTION_DIM


class QNet(nn.Module):
    """Q head always; gen15+ nets also carry a BELIEF head — a per-card
    classifier over who holds each of the 40 cards (relative seats 1/2/3 or
    the hidden go-down), read off the last hidden layer. forward() stays
    q-only so every driver, duel, search and browser export is untouched;
    training calls belief_forward() for the auxiliary loss."""

    def __init__(self, hidden: tuple[int, ...] = (512, 512, 256),
                 state_dim: int = STATE_DIM, belief: bool = False):
        super().__init__()
        layers: list[nn.Module] = []
        d = state_dim + ACTION_DIM
        for h in hidden:
            layers += [nn.Linear(d, h), nn.ReLU()]
            d = h
        layers.append(nn.Linear(d, 1))
        self.net = nn.Sequential(*layers)
        self.belief_head = nn.Linear(d, 40 * 4) if belief else None

    def _trunk(self, state: torch.Tensor, action: torch.Tensor) -> torch.Tensor:
        x = torch.cat([state, action], dim=-1)
        for m in self.net[:-1]:
            x = m(x)
        return x

    def forward(self, state: torch.Tensor, action: torch.Tensor) -> torch.Tensor:
        return self.net(torch.cat([state, action], dim=-1)).squeeze(-1)

    def q_and_belief(self, state: torch.Tensor, action: torch.Tensor):
        """(q, belief_logits[batch, 40, 4]) — training-time only."""
        h = self._trunk(state, action)
        q = self.net[-1](h).squeeze(-1)
        b = self.belief_head(h).view(-1, 40, 4)
        return q, b


def load_qnet(ckpt_path: str) -> QNet:
    """Load any generation's checkpoint. Everything is inferred from the
    weights themselves: input width names the encoder version (479+50 = v1
    gen7-gen10, 508+50 = v2 gen13+), layer shapes name the trunk widths,
    and a belief_head key names a gen15+ net."""
    ck = torch.load(ckpt_path, map_location="cpu", weights_only=True)
    sd = ck["model"] if "model" in ck else ck
    lin_keys = sorted((k for k in sd if k.startswith("net.")
                       and k.endswith(".weight")),
                      key=lambda k: int(k.split(".")[1]))
    in_dim = sd[lin_keys[0]].shape[1]
    hidden = tuple(int(sd[k].shape[0]) for k in lin_keys[:-1])
    net = QNet(hidden=hidden, state_dim=in_dim - ACTION_DIM,
               belief="belief_head.weight" in sd)
    net.load_state_dict(sd)
    net.eval()
    return net
