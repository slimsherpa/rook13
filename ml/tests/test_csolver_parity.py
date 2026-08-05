"""The C oracle must give BYTE-IDENTICAL answers to the Python oracle.

Positions come from real engine games played by random-legal bots (fast,
and they visit weird corners no curated set would), sampled at every
trick depth including mid-trick, plus `only=` filtering both in its
collapsed and fallback branches. Exactness is the whole product — one
mismatch is a failing test, not a statistic.
"""

import random

import pytest

from rook.cards import CARD_POINTS, create_deck
from rook.engine import Game, PLAYING
from rook import solver as PY

C = pytest.importorskip("rook.csolver")


def _drive_to_play(rng, dealer):
    """Deal + minimal auction so the hand reaches PLAYING legally."""
    g = Game(dealer=dealer)
    deck = create_deck()
    rng.shuffle(deck)
    g.deal(deck)
    order = [(dealer + 1 + i) % 4 for i in range(4)]
    for s in order[:3]:
        g.bid(s, 0)
    g.bid(order[3], 70)
    bidder = order[3]
    g.select_go_down(bidder, sorted(g.hands[bidder])[:4])
    g.select_trump(bidder, max(range(4), key=lambda su: sum(
        1 for c in g.hands[bidder] if c // 10 == su)))
    return g


def test_values_match():
    rng = random.Random(123)
    n_checked = 0
    for gi in range(8):
        g = _drive_to_play(rng, gi % 4)
        while g.phase == PLAYING:
            # Python cost explodes at low trick counts; sample sparsely
            # there (the recursion is identical at every depth, so deep
            # positions carry the same parity evidence per second)
            tr = len(g.completed_tricks)
            p = 0.02 if tr == 0 else 0.08 if tr == 1 else 0.5
            if rng.random() < p:
                hands = [list(h) for h in g.hands]
                kw = dict(t0_tricks=g.tricks_won[0],
                          tricks_done=len(g.completed_tricks),
                          trick=tuple((s, c) for s, c in g.trick_plays))
                gd = sum(CARD_POINTS[c] for c in g.go_down)
                pv = PY.solve(hands, g.trump, g.trick_leader, gd, **kw)
                cv = C.solve(hands, g.trump, g.trick_leader, gd, **kw)
                assert pv == cv, f"solve mismatch {pv} != {cv}"
                pvals = PY.play_values(hands, g.trump, g.trick_leader, gd,
                                       **kw)
                cvals = C.play_values(hands, g.trump, g.trick_leader, gd,
                                      **kw)
                assert pvals == cvals, f"play_values {pvals} != {cvals}"
                cands = g.legal_cards(g.turn)
                po = PY.play_values(hands, g.trump, g.trick_leader, gd,
                                    only=list(cands), **kw)
                co = C.play_values(hands, g.trump, g.trick_leader, gd,
                                   only=list(cands), **kw)
                assert po == co, f"only= mismatch {po} != {co}"
                # single-card fallback branch (collapsed twins)
                c1 = cands[0]
                p1 = PY.play_values(hands, g.trump, g.trick_leader, gd,
                                    only=[c1], **kw)[c1]
                c1v = C.play_values(hands, g.trump, g.trick_leader, gd,
                                    only=[c1], **kw)[c1]
                assert p1 == c1v
                n_checked += 1
            s = g.turn
            g.play_card(s, rng.choice(g.legal_cards(s)))
    assert n_checked >= 60, f"only {n_checked} positions checked"
