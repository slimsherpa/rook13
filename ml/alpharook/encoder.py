"""Observation -> feature vectors for the Deep Monte Carlo network.

encode_state() consumes ONLY an Observation (plus the agent's own pending
go-down picks and public auction context) — never a Game's hidden zones.
tests/test_leak.py proves hidden cards cannot influence the output.

Everything is seat-relative: index 0 = me, 1 = left opponent, 2 = partner,
3 = right opponent, so one network plays all four chairs.
"""

from __future__ import annotations

import numpy as np

from rook.cards import PASS, SEATS, VALID_BIDS, team_of, suit_of
from rook.engine import Game
from rook.observation import Observation, known_voids, hand_sizes

# decision types
D_BID = 0
D_DISCARD = 1
D_TRUMP = 2
D_PLAY = 3

ACTION_DIM = 50  # [type onehot 4, is_pass, bid/120, card onehot 40, suit onehot 4]

# state layout (sizes):
#   my hand ................. 40
#   my go-down / picks ...... 40
#   played by rel seat ...... 160
#   current trick by rel .... 160
#   trick leader rel ........ 5   (4 + none)
#   trick position .......... 1
#   trump ................... 5   (4 + none)
#   decision type ........... 4
#   bids per rel seat ....... 12  ([silent, passed, value/120] x 4)
#   high bid /120 ........... 1
#   must-bid flag ........... 1
#   floor /120 .............. 1
#   bid winner rel .......... 5   (4 + none)
#   my team declaring ....... 1
#   known voids rel x suit .. 16
#   hand sizes rel /9 ....... 4
#   tricks won us/them /9 ... 2
#   points taken us/them .... 2
#   game scores & distances . 7
#   trick number /9 ......... 1
STATE_DIM = 40 + 40 + 160 + 160 + 5 + 1 + 5 + 4 + 12 + 1 + 1 + 1 + 5 + 1 + 16 + 4 + 2 + 2 + 7 + 1


def encode_state(o: Observation, picks: list[int], decision_type: int,
                 g: Game) -> np.ndarray:
    """`g` is used ONLY for public auction context (must_bid / min_next_bid),
    which derives from the public bids — never hidden zones."""
    me = o.seat
    rel = lambda s: (s - me) % 4  # noqa: E731
    x = np.zeros(STATE_DIM, dtype=np.float32)
    base = 0

    # my hand
    for c in o.hand:
        x[base + c] = 1.0
    base += 40

    # my go-down (bid winner only) plus pending discard picks
    gd = list(o.my_go_down or []) + list(picks)
    for c in gd:
        x[base + c] = 1.0
    base += 40

    # cards played this hand, by relative seat
    for _, plays, _, _ in o.completed_tricks:
        for s, c in plays:
            x[base + rel(s) * 40 + c] = 1.0
    for s, c in o.trick_plays:
        x[base + rel(s) * 40 + c] = 1.0
    base += 160

    # current trick only, by relative seat
    for s, c in o.trick_plays:
        x[base + rel(s) * 40 + c] = 1.0
    base += 160

    # trick leader (relative) or none
    if o.trick_leader is not None:
        x[base + rel(o.trick_leader)] = 1.0
    else:
        x[base + 4] = 1.0
    base += 5

    x[base] = len(o.trick_plays) / 4.0
    base += 1

    # trump
    if o.trump is not None:
        x[base + o.trump] = 1.0
    else:
        x[base + 4] = 1.0
    base += 5

    x[base + decision_type] = 1.0
    base += 4

    # bids per relative seat
    for s in SEATS:
        r = rel(s)
        b = o.bids[s]
        if b is None:
            x[base + r * 3 + 0] = 1.0
        elif b == PASS:
            x[base + r * 3 + 1] = 1.0
        else:
            x[base + r * 3 + 2] = b / 120.0
    base += 12

    x[base] = (o.high_bid or 0) / 120.0
    base += 1
    x[base] = 1.0 if g.must_bid() else 0.0
    base += 1
    floor = g.min_next_bid()
    x[base] = (floor or 0) / 120.0
    base += 1

    if o.bid_winner is not None:
        x[base + rel(o.bid_winner)] = 1.0
    else:
        x[base + 4] = 1.0
    base += 5

    my_team = team_of(me)
    x[base] = 1.0 if (o.bid_winner is not None
                      and team_of(o.bid_winner) == my_team) else 0.0
    base += 1

    # known voids (relative seat x suit)
    voids = known_voids(o)
    for s in SEATS:
        for suit in voids[s]:
            x[base + rel(s) * 4 + suit] = 1.0
    base += 16

    sizes = hand_sizes(o)
    for s in SEATS:
        x[base + rel(s)] = sizes[s] / 9.0
    base += 4

    opp = 1 - my_team
    x[base] = o.tricks_won[my_team] / 9.0
    x[base + 1] = o.tricks_won[opp] / 9.0
    base += 2
    x[base] = o.points_taken[my_team] / 100.0
    x[base + 1] = o.points_taken[opp] / 100.0
    base += 2

    # game context: the reason we train on full games (-250..500)
    mine, theirs = o.scores[my_team], o.scores[opp]
    x[base] = mine / 500.0
    x[base + 1] = theirs / 500.0
    x[base + 2] = (500 - mine) / 750.0     # our distance to winning
    x[base + 3] = (500 - theirs) / 750.0   # their distance to winning
    x[base + 4] = (mine + 250) / 750.0     # our distance from elimination
    x[base + 5] = (theirs + 250) / 750.0
    x[base + 6] = min(o.hand_number, 20) / 20.0
    base += 7

    x[base] = len(o.completed_tricks) / 9.0
    base += 1

    assert base == STATE_DIM
    return x


def encode_action(decision_type: int, action) -> np.ndarray:
    """action: for D_BID an int (PASS or 65..120); for D_DISCARD / D_PLAY a
    card int; for D_TRUMP a suit int."""
    a = np.zeros(ACTION_DIM, dtype=np.float32)
    a[decision_type] = 1.0
    if decision_type == D_BID:
        if action == PASS:
            a[4] = 1.0
        else:
            a[5] = action / 120.0
    elif decision_type in (D_DISCARD, D_PLAY):
        a[6 + action] = 1.0
        a[46 + suit_of(action)] = 1.0
    elif decision_type == D_TRUMP:
        a[46 + action] = 1.0
    return a
