"""MORTALGODROOK — god's brain with mortal eyes (gen24, 2026-08-02).

Riley's blinding idea, pointed the ledger-legal direction: at every card
decision, sample K worlds consistent with WHAT THIS SEAT CAN SEE (drawn
from the belief posterior — the stack's own imagination), EXACT-SOLVE
every candidate card in every world, and average. No rollout noise, no
peeking: the labels-only marginalization law (solver.py header), walking
around with a chair at the table.

This is the measurement instrument for the true mortal card-play
ceiling: MortalGod vs the Cosmo stack on duplicate decks, per-hand
currency, prices exactly how many points the best information-legal
player we can construct gets over production. Two honest caveats,
stated up front:
  * the number is a LOWER bound on the true ceiling — imagination
    quality is gen15's posterior; a truer posterior raises it;
  * per-world values are converted to FAMILY hand currency (set = -bid,
    make = points) before averaging, so the oracle optimizes the game
    the family scores, not raw points.

Bids, widow and trump stay with the supplied net (like god.py), so the
duel isolates card play — Riley's decomposition.

Cost: dominated by trick-0/1 solves; tune --mortal K to the wall-clock
budget. Duck-types SearchAgent for duel.py (.choose, .last_search).
"""

from __future__ import annotations

import random

from rook.cards import team_of
from rook.determinize import sample_world, sample_world_weighted
from rook.observation import observe
# The C oracle (58-66x, parity-gated by tests/test_csolver_parity.py);
# ROOK_PURE_PY=1 forces the Python reference implementation.
import os as _os
if _os.environ.get("ROOK_PURE_PY"):
    from rook import solver as S
else:
    try:
        from rook import csolver as S
    except Exception as _e:
        # LOUD fallback: a silent 60x slowdown hid a broken toolchain on
        # hil-6 once (2026-08-04). Never again.
        print(f"[mortalgod] WARNING: C solver unavailable ({_e}); "
              f"falling back to PYTHON solver (~60x slower)", flush=True)
        from rook import solver as S

from .arena import model_choose
from .encoder import D_PLAY
from .search import materialize


CAND_CAP = 6          # exact-solve only the net's top-N candidates
EARLY_TRICKS = 2      # tricks 0..EARLY-1 use worlds//2 (full-tree solves)


def hand_value(pts0: int, bid_team: int, bid: int, my_team: int) -> int:
    """Family hand currency from a solved team-0 point total: set = -bid,
    make = points; returns my_team's hand-score minus the opponents'."""
    pts = (pts0, S.TOTAL_POINTS - pts0)
    hs_bid = -bid if pts[bid_team] < bid else pts[bid_team]
    hs_def = pts[1 - bid_team]
    hs = (hs_bid, hs_def) if bid_team == 0 else (hs_def, hs_bid)
    return hs[my_team] - hs[1 - my_team]


class MortalGodAgent:
    def __init__(self, net, belief, worlds: int = 8, seed: int = 0):
        self.net = net
        self.belief = belief
        self.worlds = worlds
        self.rng = random.Random(seed ^ 0x60D)
        self.last_search = None

    def _prune(self, env, seat, dtype, cands):
        """Cost cap: the champion ranks, the oracle prices the top-N.
        Slightly lowers the oracle (a card the champion ranks bottom is
        never priced) — the measured ceiling stays a LOWER bound."""
        if len(cands) <= CAND_CAP:
            return list(cands)
        import numpy as np
        import torch
        from .encoder import encode_state_for, encode_action
        s = encode_state_for(self.net, observe(env.g, seat), env.picks,
                             dtype, env.g, env.trump_intent)
        with torch.no_grad():
            S_ = torch.from_numpy(np.stack([s] * len(cands)))
            A_ = torch.from_numpy(
                np.stack([encode_action(dtype, a) for a in cands]))
            q = self.net(S_, A_).numpy()
        order = np.argsort(-q)[:CAND_CAP]
        return [cands[int(i)] for i in order]

    def choose(self, env, seat, dtype, cands):
        if dtype != D_PLAY or len(cands) <= 1:
            return model_choose(self.net, "cpu", env, seat, dtype, cands)
        g0 = env.g
        o = observe(g0, seat)
        cands = self._prune(env, seat, dtype, cands)
        probs = None
        if self.belief is not None:
            try:
                probs = self.belief.posterior(env, seat, o, dtype, cands)
            except Exception:
                probs = None
        my_team = team_of(seat)
        bid_team = team_of(g0.bid_winner)
        bid = g0.high_bid
        totals = {c: 0.0 for c in cands}
        k_done = 0
        k_target = (max(3, self.worlds // 2)
                    if len(g0.completed_tricks) < EARLY_TRICKS
                    else self.worlds)
        for _ in range(k_target):
            try:
                if probs is not None:
                    hands, gd = sample_world_weighted(o, self.rng, probs)
                else:
                    hands, gd = sample_world(o, self.rng)
            except Exception:
                continue
            g = materialize(o, hands, gd, g0.win_score, g0.lose_score)
            kw = dict(t0_tricks=g.tricks_won[0],
                      tricks_done=len(g.completed_tricks),
                      trick=tuple(g.trick_plays))
            hh = [list(h) for h in g.hands]
            vals = S.play_values(hh, g.trump, g.trick_leader,
                                 g.go_down_points(), only=list(cands), **kw)
            for c in cands:
                if c not in vals:
                    # collapsed twin of a representative in THIS world's
                    # remaining-card set; only=[c] always prices it
                    vals[c] = S.play_values(hh, g.trump, g.trick_leader,
                                            g.go_down_points(), only=[c],
                                            **kw)[c]
            for c in cands:
                totals[c] += hand_value(g.points_taken[0] + vals[c],
                                        bid_team, bid, my_team)
            k_done += 1
        if not k_done:
            return model_choose(self.net, "cpu", env, seat, dtype, cands)
        return max(cands, key=lambda c: totals[c])


class MortalRookAgent(MortalGodAgent):
    """The DISCIPLINED mortal — the probe's split-sample rule as a player.

    The raw MortalGodAgent lost its duel exactly as law told us it would
    (winner's curse at small K). The probe then showed the same
    calculation, disciplined, gains +2..+4/decision. This agent IS that
    discipline: the reflex incumbent stands unless a challenger picked
    on the SELECTION worlds also beats it on FRESH evaluation worlds by
    at least tau points. Overrides must earn their seat twice."""

    def __init__(self, net, belief, worlds: int = 48, eval_worlds: int = 24,
                 tau: float = 2.0, seed: int = 0):
        super().__init__(net, belief, worlds=worlds, seed=seed)
        self.eval_worlds = eval_worlds
        self.tau = tau
        # telemetry: {trick: [decisions, challenged, confirmed-overrides]}
        self.stats: dict = {}

    def _means(self, env, o, cands, k, probs):
        g0 = env.g
        seat = g0.turn
        bid_team = team_of(g0.bid_winner)
        bid = g0.high_bid
        team = team_of(seat)
        totals = {c: 0.0 for c in cands}
        done = 0
        for _ in range(k):
            try:
                if probs is not None:
                    hands, gd = sample_world_weighted(o, self.rng, probs)
                else:
                    hands, gd = sample_world(o, self.rng)
            except Exception:
                continue
            g = materialize(o, hands, gd, g0.win_score, g0.lose_score)
            kw = dict(t0_tricks=g.tricks_won[0],
                      tricks_done=len(g.completed_tricks),
                      trick=tuple(g.trick_plays))
            hh = [list(h) for h in g.hands]
            vals = S.play_values(hh, g.trump, g.trick_leader,
                                 g.go_down_points(), only=list(cands), **kw)
            for c in cands:
                if c not in vals:
                    vals[c] = S.play_values(hh, g.trump, g.trick_leader,
                                            g.go_down_points(), only=[c],
                                            **kw)[c]
                totals[c] += hand_value(g.points_taken[0] + vals[c],
                                        bid_team, bid, team)
            done += 1
        if not done:
            return None
        return {c: t / done for c, t in totals.items()}

    def choose(self, env, seat, dtype, cands):
        if dtype != D_PLAY or len(cands) <= 1:
            return model_choose(self.net, "cpu", env, seat, dtype, cands)
        incumbent = model_choose(self.net, "cpu", env, seat, dtype, cands)
        o = observe(env.g, seat)
        use = self._prune(env, seat, dtype, list(cands))
        if incumbent not in use:
            use[-1] = incumbent
        probs = None
        if self.belief is not None:
            try:
                probs = self.belief.posterior(env, seat, o, dtype, use)
            except Exception:
                probs = None
        trick = len(env.g.completed_tricks)
        st = self.stats.setdefault(trick, [0, 0, 0])
        st[0] += 1
        k_sel = (max(3, self.worlds // 2)
                 if trick < EARLY_TRICKS
                 else self.worlds)
        means = self._means(env, o, use, k_sel, probs)
        if means is None:
            return incumbent
        challenger = max(use, key=lambda c: means[c])
        if challenger == incumbent:
            return incumbent
        st[1] += 1
        ev = self._means(env, o, [challenger, incumbent],
                         self.eval_worlds, probs)
        if ev is None or ev[challenger] - ev[incumbent] < self.tau:
            return incumbent
        st[2] += 1
        return challenger
