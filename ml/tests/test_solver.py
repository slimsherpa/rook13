"""The oracle must be EXACT. Three independent checks:

1. vs plain minimax — no alpha-beta, no transposition table, no
   equivalence collapsing. If any optimization is unsound the values
   diverge. Run on small deals so brute force is tractable.
2. vs the real engine — replay the oracle's own optimal line through
   rook.engine and confirm the scoring matches, so the solver's rules ARE
   the game's rules (trick winner, follow-suit, go-down, trick bonus).
3. constant-sum — every deal must total exactly 120 points.
"""
import random

import pytest

from rook.cards import CARD_POINTS, TAKING_TRICKS_BONUS, team_of
from rook.engine import PLAYING, Game, winning_card_seat
from rook import solver as S


def _deal(rng, per_hand):
    deck = list(range(40))
    rng.shuffle(deck)
    return [sorted(deck[i * per_hand:(i + 1) * per_hand]) for i in range(4)]


def brute(hands, trump, turn, gd, n_tricks, bonus_at):
    """Reference minimax. Deliberately naive."""
    hands = [list(h) for h in hands]

    def rec(hands, turn, trick, t0_tricks, done):
        if done == n_tricks:
            return TAKING_TRICKS_BONUS if t0_tricks >= bonus_at else 0
        lead = None if not trick else trick[0][1] // 10
        opts = [c for c in hands[turn] if c // 10 == lead] if lead is not None \
            else list(hands[turn])
        if not opts:
            opts = list(hands[turn])
        maxing = team_of(turn) == 0
        best = None
        for c in opts:
            nh = [list(x) for x in hands]
            nh[turn].remove(c)
            nt = trick + [(turn, c)]
            if len(nt) < 4:
                v = rec(nh, (turn + 1) % 4, nt, t0_tricks, done)
            else:
                w = winning_card_seat(nt, trump)
                pts = sum(CARD_POINTS[x] for _, x in nt)
                won0 = team_of(w) == 0
                v = pts if won0 else 0
                if done == n_tricks - 1 and won0:
                    v += gd
                v += rec(nh, w, [], t0_tricks + won0, done + 1)
            if best is None or (v > best if maxing else v < best):
                best = v
        return best

    return rec(hands, turn, [], 0, 0)


@pytest.mark.parametrize("per_hand", [2, 3, 4])
def test_matches_brute_force(per_hand):
    rng = random.Random(4242 + per_hand)
    for trial in range(12):
        hands = _deal(rng, per_hand)
        trump = rng.choice([None, 0, 1, 2, 3])
        leader = rng.randrange(4)
        gd = rng.choice([0, 10, 20])
        bonus_at = per_hand // 2 + 1
        want = brute(hands, trump, leader, gd, per_hand, bonus_at)
        got = S.solve(hands, trump, leader, gd,
                      bonus_at=bonus_at)
        assert got == want, (
            f"trial {trial} per_hand={per_hand} trump={trump} "
            f"leader={leader} gd={gd}: solver {got} != brute {want}")


def test_best_play_value_agrees_with_solve():
    rng = random.Random(77)
    for _ in range(10):
        hands = _deal(rng, 4)
        trump = rng.choice([None, 0, 1, 2, 3])
        leader = rng.randrange(4)
        card, val = S.best_play(hands, trump, leader, 20, bonus_at=3)
        assert card in hands[leader]
        assert val == S.solve(hands, trump, leader, 20, bonus_at=3)


def test_constant_sum_full_deal():
    """A real 9-trick deal always distributes exactly 120 points: solving
    from team 0's view and from team 1's view must add to 120."""
    rng = random.Random(11)
    for _ in range(3):
        deck = list(range(40))
        rng.shuffle(deck)
        hands = [sorted(deck[i * 9:(i + 1) * 9]) for i in range(4)]
        go_down = deck[36:]
        gd = sum(CARD_POINTS[c] for c in go_down)
        trump = rng.randrange(4)
        t0 = S.solve(hands, trump, 0, gd)
        # rotate seats by one: team 1 becomes team 0
        rot = hands[1:] + hands[:1]
        t1 = S.solve(rot, trump, 3, gd)
        assert t0 + t1 == S.TOTAL_POINTS, (t0, t1)


def test_optimal_line_replays_through_the_real_engine():
    """Walk the oracle's own optimal line card by card through rook.engine
    and confirm the engine scores it exactly as the oracle predicted."""
    rng = random.Random(2026)
    for _ in range(3):
        deck = list(range(40))
        rng.shuffle(deck)
        hands = [sorted(deck[i * 9:(i + 1) * 9]) for i in range(4)]
        go_down = deck[36:]
        gd = sum(CARD_POINTS[c] for c in go_down)
        trump, leader = rng.randrange(4), rng.randrange(4)
        par = S.solve(hands, trump, leader, gd)

        # drive the engine straight into PLAYING with this exact layout
        g = Game(dealer=0)
        g.phase = PLAYING
        g.hands = [list(h) for h in hands]
        g.go_down = list(go_down)
        g.trump = trump
        g.turn = leader
        g.trick_leader = leader
        g.trick_plays = []
        g.completed_tricks = []
        g.tricks_won = [0, 0]
        g.points_taken = [0, 0]
        g.bid_winner, g.high_bid = leader, 65

        live = [list(h) for h in hands]
        trick, done, t0_tricks, last_w = (), 0, 0, None
        while done < 9:
            turn = g.turn
            card, _ = S.best_play(live, trump, turn, gd, t0_tricks=t0_tricks,
                                  tricks_done=done, trick=trick)
            live[turn].remove(card)
            g.play_card(turn, card)      # engine asserts legality for us
            trick = trick + ((turn, card),)
            if len(trick) == 4:
                w = winning_card_seat(list(trick), trump)
                # the engine independently resolved the same trick
                assert g.trick_leader == w
                t0_tricks += team_of(w) == 0
                last_w, done, trick = w, done + 1, ()

        # engine's raw trick points, plus Rook's two extras (go-down to the
        # last trick, +20 for taking 5) — the oracle's exact definition
        total0 = g.points_taken[0]
        if team_of(last_w) == 0:
            total0 += gd
        if g.tricks_won[0] >= 5:
            total0 += TAKING_TRICKS_BONUS
        assert g.tricks_won[0] == t0_tricks
        assert total0 == par, (total0, par, g.points_taken, g.tricks_won)
        assert g.points_taken[0] + g.points_taken[1] + gd == 100
