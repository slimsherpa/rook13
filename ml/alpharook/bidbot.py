"""P2 — BidBot at the table: the humility-switch override agent.

The trained BidNet (bidbot_train) reads the full at-the-table view —
every bid in order, the score, the hand — and holds 13 action values in
winprob currency. At each live bid decision the HOUSE (reflex net) still
proposes; BidBot overrides only when its best legal alternative clears
the calibration bar tau. Where its opinion is a wash, the house stands.

Standing law honored: the net was trained on twin outcomes; nothing here
rolls out or searches at decision time (winner's curse).

Duck-types the duel agent interface (.choose, .last_search) by wrapping
the assembled play agent — bids intercepted, everything else delegated.
"""

from __future__ import annotations

import torch

from .arena import model_choose
from .bidbot_features import ACTIONS, A_INDEX, bid_features
from .bidbot_train import BidNet
from .encoder import D_BID
from .winprob import WinProb


class BidBot:
    def __init__(self, ckpt_path: str, winprob_path: str, tau: float):
        ck = torch.load(ckpt_path, map_location="cpu", weights_only=False)
        self.net = BidNet(in_dim=ck["in_dim"])
        self.net.load_state_dict(ck["model"])
        self.net.eval()
        self.wp = WinProb(winprob_path)
        self.tau = tau

    @torch.no_grad()
    def choose_bid(self, env, seat: int, cands: list, house: int):
        """Returns (pick, delta, u_house, s_pick): the chosen bid, the
        claimed swing over the house, and the daydream score readout."""
        x = torch.from_numpy(bid_features(env.g, seat, self.wp)).unsqueeze(0)
        u, s = self.net(x)
        u, s = u[0], s[0]
        hi = A_INDEX[house]
        best, best_u = house, u[hi]
        for c in cands:
            ci = A_INDEX[c]
            if u[ci] > best_u:
                best, best_u = c, u[ci]
        delta = float(best_u - u[hi])
        pick = best if delta > self.tau else house
        return pick, delta, float(u[hi]), float(s[A_INDEX[pick]])


class BidBotAgent:
    """Wraps the assembled agent: BidBot on the auction, inner elsewhere."""

    def __init__(self, inner, reflex_net, bidbot: BidBot):
        self.inner = inner
        self.net = reflex_net          # duel.py reads .net for needle tests
        self.bidbot = bidbot
        self.last_search = None
        self.n_bids = 0
        self.n_overrides = 0

    def choose(self, env, seat: int, dtype: int, cands: list):
        if dtype == D_BID:
            self.last_search = None
            house = model_choose(self.net, "cpu", env, seat, dtype, cands)
            if len(cands) <= 1:
                return house
            pick, delta, _, _ = self.bidbot.choose_bid(env, seat, cands, house)
            self.n_bids += 1
            if pick != house:
                self.n_overrides += 1
            return pick
        if self.inner is not None:
            pick = self.inner.choose(env, seat, dtype, cands)
            self.last_search = getattr(self.inner, "last_search", None)
            return pick
        return model_choose(self.net, "cpu", env, seat, dtype, cands)
