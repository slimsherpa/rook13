"""ALPHAGODROOK — the omniscient cheater, as a playable agent.

Card play is the exact double-dummy solver conditioned on the TRUE deal
(rook/solver.py). Bids, widow and trump stay with the supplied net — the
same bidding brain as the rest of the ladder — so god-mode measures the
ceiling of CARD PLAY, comparable apples-to-apples with every other arm.

Law 9 does not apply here and that is worth saying out loud: strategy
fusion poisons TEACHERS (cloning peeked choices teaches finesses that only
work because you peeked). A sparring dummy that never trains anyone is the
one legitimate place to condition on the truth. AlphaGodRook is a referee
with a chair at the table: the calibration arm for "how good can play
possibly be", and the secret humbling mode Riley asked for.
"""

from __future__ import annotations

from rook.cards import CARD_POINTS
from rook import solver as S

from .arena import model_choose
from .encoder import D_PLAY


def position(g):
    """The live engine state, in the solver's vocabulary (ceiling.py's
    _position, shared here so both stay in lockstep)."""
    return {
        "hands": [list(h) for h in g.hands],
        "trump": g.trump,
        "gd": sum(CARD_POINTS[c] for c in g.go_down),
        "trick": tuple((s, c) for s, c in g.trick_plays),
        "tricks_done": len(g.completed_tricks),
        "t0_tricks": g.tricks_won[0],
        "leader": g.trick_leader,
    }


class GodAgent:
    """Duck-types SearchAgent for duel.py's play loop: .choose() and a
    .last_search attribute (always None — there is nothing stochastic to
    record; god does not take notes)."""

    def __init__(self, net):
        self.net = net
        self.last_search = None

    def choose(self, env, seat, dtype, cands):
        if dtype != D_PLAY or len(cands) <= 1:
            return model_choose(self.net, "cpu", env, seat, dtype, cands)
        p = position(env.g)
        card, _v = S.best_play(p["hands"], p["trump"], p["leader"],
                               p["gd"], t0_tricks=p["t0_tricks"],
                               tricks_done=p["tricks_done"],
                               trick=p["trick"])
        # the solver only proposes cards the engine allows; if a rules
        # nuance ever disagrees, defer to the engine's candidate list
        return card if card in cands else \
            model_choose(self.net, "cpu", env, seat, dtype, cands)
