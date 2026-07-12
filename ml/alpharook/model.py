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
    def __init__(self, hidden: tuple[int, ...] = (512, 512, 256),
                 state_dim: int = STATE_DIM):
        super().__init__()
        layers: list[nn.Module] = []
        d = state_dim + ACTION_DIM
        for h in hidden:
            layers += [nn.Linear(d, h), nn.ReLU()]
            d = h
        layers.append(nn.Linear(d, 1))
        self.net = nn.Sequential(*layers)

    def forward(self, state: torch.Tensor, action: torch.Tensor) -> torch.Tensor:
        return self.net(torch.cat([state, action], dim=-1)).squeeze(-1)


def load_qnet(ckpt_path: str) -> QNet:
    """Load any generation's checkpoint; the input width names the encoder
    version (479+50 = v1 gen7-gen10, 508+50 = v2 gen13+)."""
    ck = torch.load(ckpt_path, map_location="cpu", weights_only=True)
    sd = ck["model"] if "model" in ck else ck
    in_dim = sd["net.0.weight"].shape[1]
    net = QNet(state_dim=in_dim - ACTION_DIM)
    net.load_state_dict(sd)
    net.eval()
    return net
