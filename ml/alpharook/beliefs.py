"""gen16: the belief head as an imagination oracle.

gen15 built the organ — a head that reads the net's first hidden layer and
predicts who holds every card the observer can't see (44% vs the 32%
uniform floor, sharpening trick by trick). gen15 the CHAMPION never
happened (strength parity, not promoted), but the organ doesn't need its
host to win: here it serves a different master. The search agent keeps the
reigning champion (gen13) as its Q/rollout policy and consults THIS net
only to decide which worlds are worth imagining — posterior-guided
determinization instead of uniform.

The no-omniscience contract holds: the oracle consumes the same
Observation-derived encoding as every other net, and the existing leak
test machinery covers any agent that routes through it.
"""

from __future__ import annotations

import numpy as np
import torch

from .encoder import encode_action, encode_state_for
from .model import load_qnet


class BeliefOracle:
    """P(who holds each hidden card) from a gen15+ belief head.

    temp: softmax temperature over the 4 holder classes. 1.0 = the head's
    honest posterior; >1 flattens toward uniform (hedged imagination for a
    noisy head), <1 sharpens (trust it more than it trusts itself).
    """

    def __init__(self, ckpt: str | None = None, temp: float = 1.0,
                 device: str = "cpu", net=None):
        self.net = net if net is not None else load_qnet(ckpt)
        assert self.net.belief_head is not None, \
            f"{ckpt or 'net'} has no belief head — need a gen15+ checkpoint"
        self.temp = temp
        self.device = device
        self.net.eval()

    @torch.no_grad()
    def posterior(self, env, seat: int, o, dtype: int, cands: list) -> np.ndarray:
        """[40, 4] class probabilities in the belief-target convention
        (cls 0/1/2 = relative seats 1..3, cls 3 = hidden widow/go-down),
        averaged over the candidate actions at this decision."""
        s = encode_state_for(self.net, o, env.picks, dtype, env.g,
                             env.trump_intent)
        S = torch.from_numpy(np.stack([s] * len(cands))).to(self.device)
        A = torch.from_numpy(
            np.stack([encode_action(dtype, a) for a in cands])).to(self.device)
        logits = self.net.belief_forward(S, A)          # [n, 40, 4]
        p = torch.softmax(logits / self.temp, dim=-1).mean(0)
        return p.cpu().numpy()
