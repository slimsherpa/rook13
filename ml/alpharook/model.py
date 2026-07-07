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
    def __init__(self, hidden: tuple[int, ...] = (512, 512, 256)):
        super().__init__()
        layers: list[nn.Module] = []
        d = STATE_DIM + ACTION_DIM
        for h in hidden:
            layers += [nn.Linear(d, h), nn.ReLU()]
            d = h
        layers.append(nn.Linear(d, 1))
        self.net = nn.Sequential(*layers)

    def forward(self, state: torch.Tensor, action: torch.Tensor) -> torch.Tensor:
        return self.net(torch.cat([state, action], dim=-1)).squeeze(-1)
