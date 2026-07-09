"""Full-game self-play environment.

Wraps the parity-tested engine and exposes the game as a stream of agent
decision points across COMPLETE games (-250..500): every bid, every go-down
discard (decomposed into 4 sequential single-card picks so the action space
stays small), the trump call, and every card play. Deals, redeals and
hand-advances are handled automatically.
"""

from __future__ import annotations

import random

from rook.cards import PASS, SUITS, VALID_BIDS, create_deck
from rook.engine import (
    Game, DEALING, REDEAL, BIDDING, WIDOW, TRUMP, PLAYING, HAND_DONE, GAME_OVER,
)
from .encoder import D_BID, D_DISCARD, D_TRUMP, D_PLAY


class SelfPlayGame:
    """One full game. Usage:
        while not env.done:
            seat, dtype, candidates = env.decision()
            env.apply(chosen_candidate)
    """

    def __init__(self, seed: int | None = None, deck_fn=None, dealer: int | None = None):
        """deck_fn(i) -> the i-th deal's 40-card deck. Passing the same
        deck_fn to two games gives them identical deal sequences regardless
        of how play unfolds — duplicate-bridge style evaluation."""
        self.rng = random.Random(seed)
        self.deck_fn = deck_fn
        self.deal_count = 0
        self.g = Game(dealer=self.rng.randrange(4) if dealer is None else dealer)
        self.picks: list[int] = []  # go-down cards picked so far this widow
        # Trump-intent-first (how humans think): the bid winner declares the
        # trump they INTEND before choosing discards, so discard decisions
        # are conditioned on the plan; the intent is applied automatically
        # when the engine reaches the trump phase. Private to the bid winner.
        self.trump_intent: int | None = None
        self._advance()

    @property
    def done(self) -> bool:
        return self.g.phase == GAME_OVER

    def _advance(self) -> None:
        """Run all non-decision phases until an agent must act (or game over)."""
        g = self.g
        while True:
            if g.phase in (DEALING, REDEAL):
                if self.deck_fn is not None:
                    deck = self.deck_fn(self.deal_count)
                else:
                    deck = create_deck()
                    self.rng.shuffle(deck)
                self.deal_count += 1
                g.deal(deck)
            elif g.phase == HAND_DONE:
                g.next_hand()
            elif g.phase == TRUMP and self.trump_intent is not None:
                g.select_trump(g.turn, self.trump_intent)
                self.trump_intent = None
            else:
                return  # bidding / widow / trump / playing / game_over

    def decision(self) -> tuple[int, int, list]:
        """Returns (seat, decision_type, candidates). Candidates are ints:
        bids (PASS or value), card ids, or suit ids depending on the type."""
        g = self.g
        seat = g.turn
        if g.phase == BIDDING:
            floor = g.min_next_bid()
            if floor is None:
                return seat, D_BID, [PASS]
            cands = [b for b in VALID_BIDS if b >= floor]
            if not g.must_bid():
                cands = [PASS] + cands
            return seat, D_BID, cands
        if g.phase == WIDOW:
            if self.trump_intent is None:
                return seat, D_TRUMP, list(SUITS)  # declare intent first
            hand = g.hands[seat]
            return seat, D_DISCARD, [c for c in hand if c not in self.picks]
        if g.phase == TRUMP:
            return seat, D_TRUMP, list(SUITS)  # only reached without an intent
        if g.phase == PLAYING:
            return seat, D_PLAY, g.legal_cards(seat)
        raise ValueError(f"no decision in phase {g.phase}")

    def apply(self, action) -> None:
        g = self.g
        if g.phase == BIDDING:
            g.bid(g.turn, action)
        elif g.phase == WIDOW:
            if self.trump_intent is None:
                self.trump_intent = action
                return  # no engine transition; discards come next
            self.picks.append(action)
            if len(self.picks) == 4:
                g.select_go_down(g.turn, self.picks)
                self.picks = []
        elif g.phase == TRUMP:
            g.select_trump(g.turn, action)
        elif g.phase == PLAYING:
            g.play_card(g.turn, action)
        else:
            raise ValueError(f"cannot apply in phase {g.phase}")
        self._advance()
