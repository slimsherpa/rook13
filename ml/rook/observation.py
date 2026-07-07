"""AlphaRook's window into the game — port of src/lib/alpharook/observation.ts.

The rule-integrity contract: an Observation for a seat contains exactly what
a human in that chair knows — their own cards, everything played face-up, the
bidding, and the go-down only if they took the bid. The neural encoder
consumes an Observation, never a Game, so cheating is impossible by
construction; tests/test_leak.py proves hidden cards can't influence it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .cards import SEATS, suit_of
from .engine import Game


@dataclass
class Observation:
    seat: int
    phase: int
    turn: int | None
    hand_number: int
    dealer: int | None

    # auction (fully public)
    bids: list[int | None]          # per seat: None silent, PASS, or value
    high_bid: int | None
    bid_winner: int | None
    trump: int | None

    # my private cards
    hand: list[int]
    my_go_down: list[int] | None    # only if I won the bid

    # table state (fully public)
    trick_leader: int | None
    trick_plays: list[tuple[int, int]]
    completed_tricks: list[tuple[int, list[tuple[int, int]], int, int]]
    tricks_won: list[int]
    points_taken: list[int]
    scores: list[int]


def observe(g: Game, seat: int) -> Observation:
    return Observation(
        seat=seat,
        phase=g.phase,
        turn=g.turn,
        hand_number=g.hand_number,
        dealer=g.dealer,
        bids=list(g.bids),
        high_bid=g.high_bid,
        bid_winner=g.bid_winner,
        trump=g.trump,
        hand=list(g.hands[seat]),
        my_go_down=list(g.go_down) if g.bid_winner == seat else None,
        trick_leader=g.trick_leader,
        trick_plays=list(g.trick_plays),
        completed_tricks=list(g.completed_tricks),
        tricks_won=list(g.tricks_won),
        points_taken=list(g.points_taken),
        scores=list(g.scores),
    )


def seen_cards(o: Observation) -> list[int]:
    out = [c for _, plays, _, _ in o.completed_tricks for _, c in plays]
    out.extend(c for _, c in o.trick_plays)
    out.extend(o.hand)
    if o.my_go_down:
        out.extend(o.my_go_down)
    return out


def unseen_cards(o: Observation) -> list[int]:
    seen = set(seen_cards(o))
    return [c for c in range(40) if c not in seen]


def known_voids(o: Observation) -> list[set[int]]:
    """Per seat, the suits they've shown they're out of."""
    voids: list[set[int]] = [set(), set(), set(), set()]
    all_plays = [plays for _, plays, _, _ in o.completed_tricks]
    if o.trick_plays:
        all_plays.append(o.trick_plays)
    for plays in all_plays:
        if not plays:
            continue
        lead = suit_of(plays[0][1])
        for s, c in plays:
            if suit_of(c) != lead:
                voids[s].add(lead)
    return voids


def hand_sizes(o: Observation) -> list[int]:
    played_this_trick = {s for s, _ in o.trick_plays}
    base = 9 - len(o.completed_tricks)
    return [base - (1 if s in played_this_trick else 0) for s in SEATS]
