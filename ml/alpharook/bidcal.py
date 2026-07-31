"""Empirical bid-evidence calibration: what does a gen23 bid MEAN?

The oracle samples hidden worlds weighted by how well they explain the
bids at the table. That requires a likelihood model of the ACTUAL
opponents — and gen23's auction language is its own dialect: it crawls,
its 75 is nearly mute, its willingness to say 100 is real information.
So we measure the dialect directly: run gen23 self-play, and for every
seat-hand record estimate_tricks(dealt 9) against the seat's auction
behavior. The stored classes are cumulative ("was willing to bid >= b"),
matching how a standing bid constrains a still-active crawler.

    ~/torch-env/bin/python -m alpharook.bidcal          # fit -> models/bidcal24.json
"""

from __future__ import annotations

import json
import math
import os
import statistics

from rook.cards import PASS, SEATS, VALID_BIDS, team_of

CAL_PATH = os.path.join(os.path.dirname(__file__), "..", "models",
                        "bidcal24.json")


class BidEvidence:
    """log-likelihood of a sampled hand given a seat's auction behavior."""

    def __init__(self, path: str = CAL_PATH, widen: float = 1.5):
        with open(path) as f:
            cal = json.load(f)
        self.levels = {int(k): v for k, v in cal["levels"].items()}
        self.passed = cal["passed"]
        self.widen = widen

    def bid_at_least(self, tricks: float, level: int) -> float:
        mu, sd = self.levels.get(level, self.levels[max(self.levels)])
        s = sd * self.widen
        return -((tricks - mu) ** 2) / (2 * s * s)

    def passed_out(self, tricks: float) -> float:
        mu, sd = self.passed
        s = sd * self.widen
        # one-sided: passing only rules out STRONG hands
        return -math.log1p(math.exp((tricks - (mu + 2 * sd)) / max(0.3, sd)))


def fit(games: int = 400, net_path: str = "models/gen23-cand1.pt"):
    import torch
    from rook.bots import estimate_tricks
    from .arena import model_choose
    from .duel import deck_stream
    from .encoder import D_BID
    from .env import SelfPlayGame
    from .model import load_qnet

    torch.set_num_threads(2)
    net = load_qnet(net_path)
    rows = []  # (tricks_of_dealt_9, max_real_bid or None)
    with torch.no_grad():
        for seed in range(games):
            env = SelfPlayGame(seed=seed ^ 0xCA1, deck_fn=deck_stream(seed ^ 0xCA1),
                               dealer=seed % 4)
            cur_hand = None
            snap = None
            bids: dict[int, int | None] = {}

            def flush():
                if snap is not None:
                    for s in SEATS:
                        if s in bids:
                            rows.append((estimate_tricks(snap[s]), bids[s]))

            while not env.done:
                seat, dtype, cands = env.decision()
                g = env.g
                if dtype == D_BID:
                    if cur_hand != g.hand_number:
                        flush()
                        cur_hand = g.hand_number
                        snap = [list(h) for h in g.hands]
                        bids = {}
                    action = model_choose(net, "cpu", env, seat, dtype, cands)
                    if action != PASS:
                        bids[seat] = max(action, bids.get(seat) or 0)
                    else:
                        bids.setdefault(seat, None)
                else:
                    action = model_choose(net, "cpu", env, seat, dtype, cands)
                env.apply(action)
            flush()

    levels = {}
    for b in VALID_BIDS:
        ts = [t for t, mb in rows if mb is not None and mb >= b]
        if len(ts) >= 30:
            levels[b] = (statistics.mean(ts), max(0.3, statistics.pstdev(ts)))
    passed = [t for t, mb in rows if mb is None]
    cal = dict(levels=levels,
               passed=(statistics.mean(passed),
                       max(0.3, statistics.pstdev(passed))),
               n=len(rows), games=games)
    with open(CAL_PATH, "w") as f:
        json.dump(cal, f)
    print(f"{len(rows)} seat-hands from {games} games -> {CAL_PATH}")
    print(f"  passed: tricks {cal['passed'][0]:.2f} ± {cal['passed'][1]:.2f} "
          f"(n={len(passed)})")
    for b, (mu, sd) in levels.items():
        n = sum(1 for t, mb in rows if mb is not None and mb >= b)
        print(f"  willing >= {b}: tricks {mu:.2f} ± {sd:.2f} (n={n})")


if __name__ == "__main__":
    fit()
