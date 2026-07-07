"""Heuristic bots, ported line-for-line from src/lib/game/bots.ts.

Every decision the deterministic styles make (basic/aggressive/cautious) must
match the TS bot exactly — tests/test_parity.py asserts this on golden traces.
Tie-breaking therefore mirrors the TS reduce/find semantics: strict
comparisons keep the *first* candidate.
"""

from __future__ import annotations

import random

from .cards import (
    PASS, SEATS, SUITS, VALID_BIDS, card_points, suit_of, num_of,
    team_of, partner_of,
)
from .engine import (
    Game, BIDDING, WIDOW, TRUMP, PLAYING, PHASE_NAMES, winning_card_seat,
)

# ---------------------------------------------------------------------------
# Personalities (knob-for-knob copy of PERSONALITIES in bots.ts)
# ---------------------------------------------------------------------------

PERSONALITIES: dict[str, dict] = {
    "random": dict(bid_cushion=0, min_bid_tricks=0, widow_tricks=0, war_stretch=0,
                   jump_gap=99, jump_reserve=0, partner_overbid_margin=None,
                   pulls_trump_on_defense=False, hunts_bare_tricks=False,
                   eager_ruffer=False, feeds_boss_partner=False,
                   ruffs_likely_count=False, go_down_bury_penalty=0.04),
    "basic": dict(bid_cushion=3, min_bid_tricks=0.8, widow_tricks=0, war_stretch=0,
                  jump_gap=20, jump_reserve=5, partner_overbid_margin=15,
                  pulls_trump_on_defense=False, hunts_bare_tricks=False,
                  eager_ruffer=True, feeds_boss_partner=True,
                  ruffs_likely_count=True, go_down_bury_penalty=-0.06),
    "aggressive": dict(bid_cushion=0, min_bid_tricks=0.4, widow_tricks=0.3, war_stretch=5,
                       jump_gap=15, jump_reserve=5, partner_overbid_margin=10,
                       pulls_trump_on_defense=True, hunts_bare_tricks=True,
                       eager_ruffer=True, feeds_boss_partner=True,
                       ruffs_likely_count=True, go_down_bury_penalty=-0.06),
    "cautious": dict(bid_cushion=8, min_bid_tricks=1.5, widow_tricks=-0.3, war_stretch=0,
                     jump_gap=25, jump_reserve=10, partner_overbid_margin=None,
                     pulls_trump_on_defense=False, hunts_bare_tricks=False,
                     eager_ruffer=False, feeds_boss_partner=True,
                     ruffs_likely_count=True, go_down_bury_penalty=-0.06),
}

# ---------------------------------------------------------------------------
# Hand shape helpers
# ---------------------------------------------------------------------------


def _suit_power(cards: list[int]) -> int:
    return sum(num_of(c) for c in cards)


def _group_by_suit(hand: list[int]) -> dict[int, list[int]]:
    m: dict[int, list[int]] = {}
    for c in hand:
        m.setdefault(suit_of(c), []).append(c)
    return m


def best_trump_suit(hand: list[int]) -> int:
    groups = _group_by_suit(hand)
    best, best_len, best_power = SUITS[0], -1, -1
    for suit in SUITS:
        cards = groups.get(suit, [])
        ln, power = len(cards), _suit_power(cards)
        if ln > best_len or (ln == best_len and power > best_power):
            best, best_len, best_power = suit, ln, power
    return best


def estimate_tricks_as(hand: list[int], trump: int) -> float:
    groups = _group_by_suit(hand)
    trumps = groups.get(trump, [])

    tricks = 0.0
    for c in trumps:
        n = num_of(c)
        if n == 14:
            tricks += 1.0
        elif n == 13:
            tricks += 0.8
        elif n == 12:
            tricks += 0.5
        elif n == 11:
            tricks += 0.3
    if len(trumps) >= 4:
        tricks += 0.4
    tricks += max(0, len(trumps) - 4) * 0.9

    spare_trumps = max(0, len(trumps) - 3)
    for suit in SUITS:
        if suit == trump:
            continue
        cards = groups.get(suit, [])
        nums = {num_of(c) for c in cards}
        if 14 in nums:
            tricks += 0.8
        if 13 in nums:
            tricks += 0.45 if 14 in nums else 0.25
        if len(cards) == 0 and spare_trumps > 0:
            tricks += 0.9
            spare_trumps -= 1
        elif len(cards) == 1 and spare_trumps > 0:
            tricks += 0.45
            spare_trumps -= 1
    return min(9.0, tricks)


def estimate_tricks(hand: list[int]) -> float:
    return estimate_tricks_as(hand, best_trump_suit(hand))


def choose_go_down(hand: list[int], trump: int, bury_penalty: float = -0.06) -> list[int]:
    """Brute-force the 4-card discard that keeps the strongest 9 (see TS)."""
    non_trump = [c for c in hand if suit_of(c) != trump]
    pool = non_trump if len(non_trump) >= 4 else hand
    n = len(pool)
    best = pool[:4]
    best_score = float("-inf")
    hand_set = hand  # value equality == identity for int cards (all distinct)
    for i in range(n - 3):
        for j in range(i + 1, n - 2):
            for k in range(j + 1, n - 1):
                for l in range(k + 1, n):
                    drop = (pool[i], pool[j], pool[k], pool[l])
                    keep = [c for c in hand_set if c not in drop]
                    buried = sum(card_points(c) for c in drop)
                    score = estimate_tricks_as(keep, trump) - buried * bury_penalty
                    if score > best_score:
                        best_score = score
                        best = list(drop)
    return best

# ---------------------------------------------------------------------------
# Card memory (only what this seat has legitimately seen)
# ---------------------------------------------------------------------------


def _cards_seen_by(g: Game, seat: int) -> list[int]:
    seen = [c for _, plays, _, _ in g.completed_tricks for _, c in plays]
    seen.extend(c for _, c in g.trick_plays)
    seen.extend(g.hands[seat])
    return seen


def _outstanding_in_suit(g: Game, seat: int, suit: int) -> list[int]:
    seen = {num_of(c) for c in _cards_seen_by(g, seat) if suit_of(c) == suit}
    return [n for n in range(5, 15) if n not in seen]


def _is_boss(g: Game, seat: int, card: int) -> bool:
    return all(n < num_of(card) for n in _outstanding_in_suit(g, seat, suit_of(card)))


def _known_void(g: Game, who: int, suit: int) -> bool:
    all_plays = [plays for _, plays, _, _ in g.completed_tricks] + [g.trick_plays]
    return any(
        len(plays) > 0 and suit_of(plays[0][1]) == suit
        and any(s == who and suit_of(c) != suit for s, c in plays)
        for plays in all_plays
    )

# ---------------------------------------------------------------------------
# Bidding
# ---------------------------------------------------------------------------

TRICK_TO_POINTS_BASE = 86
TRICK_TO_POINTS_PER_TRICK = 6
PARTNER_BID_BOOST = 8
PARTNER_PASS_DRAG = 4


def _expected_points(hand: list[int], widow_tricks: float) -> float:
    return TRICK_TO_POINTS_BASE + TRICK_TO_POINTS_PER_TRICK * (
        estimate_tricks(hand) + widow_tricks)


def _snap_to_bid(points: float) -> int | None:
    best = None
    for b in VALID_BIDS:
        if b <= points:
            best = b
    return best


def choose_bid(g: Game, seat: int, style: str) -> int:
    """Returns a bid value or PASS. Port of chooseBid."""
    if g.must_bid():
        return VALID_BIDS[0]
    floor = g.min_next_bid()
    if floor is None:
        return PASS

    p = PERSONALITIES[style]
    tricks = estimate_tricks(g.hands[seat])
    if tricks < p["min_bid_tricks"]:
        return PASS

    partner = partner_of(seat)
    partner_bid = g.bids[partner]  # None (silent), PASS, or value
    partner_has_high_bid = g.high_bid is not None and partner_bid == g.high_bid

    estimate = _expected_points(g.hands[seat], p["widow_tricks"]) - p["bid_cushion"]
    if partner_bid is not None and partner_bid != PASS and not partner_has_high_bid:
        estimate += PARTNER_BID_BOOST
    elif partner_bid == PASS:
        estimate -= PARTNER_PASS_DRAG
    comfort = _snap_to_bid(estimate)
    if comfort is None:
        return PASS

    if partner_has_high_bid:
        opponents_alive = any(
            team_of(s) != team_of(seat) and g.bids[s] != PASS for s in SEATS)
        if not opponents_alive:
            return PASS
        if p["partner_overbid_margin"] is None:
            return PASS
        return floor if floor + p["partner_overbid_margin"] <= comfort else PASS

    opponent_has_high_bid = g.high_bid is not None
    limit = comfort + (p["war_stretch"] if opponent_has_high_bid else 0)
    if floor > limit:
        return PASS
    if comfort - floor >= p["jump_gap"]:
        return max(floor, min(limit, comfort - p["jump_reserve"], 105))
    return floor

# ---------------------------------------------------------------------------
# Trick play
# ---------------------------------------------------------------------------


def _lowest(cards: list[int]) -> int:
    lo = cards[0]
    for c in cards[1:]:
        if num_of(c) < num_of(lo):
            lo = c
    return lo


def _highest(cards: list[int]) -> int:
    hi = cards[0]
    for c in cards[1:]:
        if num_of(c) > num_of(hi):
            hi = c
    return hi


def _cheapest(cards: list[int]) -> int:
    lo = cards[0]
    for c in cards[1:]:
        cp, lp = card_points(c), card_points(lo)
        if cp < lp or (cp == lp and num_of(c) < num_of(lo)):
            lo = c
    return lo


def _choose_lead(g: Game, seat: int, p: dict) -> int:
    hand = g.hands[seat]
    trump = g.trump
    my_trumps = [c for c in hand if suit_of(c) == trump] if trump is not None else []
    side_cards = [c for c in hand if suit_of(c) != trump]
    on_bid_team = g.bid_winner is not None and team_of(g.bid_winner) == team_of(seat)

    if trump is not None and my_trumps:
        enemy_trumps = _outstanding_in_suit(g, seat, trump)
        have_boss = all(n < num_of(_highest(my_trumps)) for n in enemy_trumps)

        if len(enemy_trumps) == 0:
            pass  # trump is dead — fall through to side suits
        elif on_bid_team or p["pulls_trump_on_defense"]:
            if have_boss:
                return _highest(my_trumps)
            if len(my_trumps) > len(enemy_trumps) and len(my_trumps) >= 3:
                non_counters = [c for c in my_trumps if card_points(c) == 0]
                return _highest(non_counters if non_counters else my_trumps)
            # otherwise don't bleed trump — fall through
        if not side_cards:
            return _highest(my_trumps)

    pool = side_cards if side_cards else hand

    bosses = [c for c in pool if _is_boss(g, seat, c) and suit_of(c) != trump]
    if bosses:
        counts = _group_by_suit(hand)
        best = bosses[0]
        for c in bosses:
            if len(counts.get(suit_of(c), [])) > len(counts.get(suit_of(best), [])):
                best = c
        return best

    non_counters = [c for c in pool if card_points(c) == 0]
    if non_counters:
        counts = _group_by_suit(hand)
        long_len = max(len(counts.get(suit_of(c), [])) for c in non_counters)
        from_long = [c for c in non_counters
                     if len(counts.get(suit_of(c), [])) == long_len]
        return _lowest(from_long)
    return _cheapest(pool)


def choose_card(g: Game, seat: int, style: str, rng: random.Random | None = None) -> int:
    legal = g.legal_cards(seat)
    if style == "random":
        return (rng or random).choice(legal)
    p = PERSONALITIES[style]

    lead = g.lead_suit()
    trump = g.trump
    played = g.trick_plays
    points_on_table = sum(card_points(c) for _, c in played)
    on_bid_team = g.bid_winner is not None and team_of(g.bid_winner) == team_of(seat)

    def would_win(card: int) -> bool:
        return winning_card_seat(played + [(seat, card)], trump) == seat

    if lead is None:
        return _choose_lead(g, seat, p)

    current_winner = winning_card_seat(played, trump)
    partner_winning = current_winner == partner_of(seat)
    partner_card = next((c for s, c in played if s == partner_of(seat)), None)
    played_seats = {s for s, _ in played}
    opps_behind = [s for s in SEATS
                   if team_of(s) != team_of(seat) and s not in played_seats]
    trumps_still_out = len(_outstanding_in_suit(g, seat, trump)) if trump is not None else 0
    partner_has_it_locked = (
        partner_winning and partner_card is not None
        and _is_boss(g, seat, partner_card)
        and (suit_of(partner_card) == trump
             or trumps_still_out == 0
             or (p["feeds_boss_partner"]
                 and all(not _known_void(g, o, suit_of(partner_card))
                         for o in opps_behind))))

    followers = [c for c in legal if suit_of(c) == lead]
    if followers:
        if partner_winning and (len(played) == 3 or partner_has_it_locked):
            counters = [c for c in followers
                        if card_points(c) > 0 and not would_win(c)]
            if counters:
                return _highest(counters)
            return _cheapest(followers)
        if not partner_winning and (points_on_table > 0 or p["hunts_bare_tricks"]
                                    or on_bid_team):
            winners = [c for c in followers if would_win(c)]
            if winners:
                return _lowest(winners) if len(played) == 3 else _highest(winners)
        return _cheapest(followers)

    # Void in the lead suit
    if trump is not None:
        trumps = [c for c in legal if suit_of(c) == trump]
        lead_counters_out = (
            len([n for n in _outstanding_in_suit(g, seat, lead)
                 if n in (5, 10, 13)]) if lead is not None else 0)
        worth_ruffing = (
            points_on_table > 0
            or (p["eager_ruffer"] and len(played) <= 2)
            or (p["ruffs_likely_count"] and len(played) <= 2 and lead_counters_out > 0))
        if trumps and not partner_winning and worth_ruffing:
            winning_trumps = [c for c in trumps if would_win(c)]
            if winning_trumps:
                return _lowest(winning_trumps)
    if partner_winning:
        feed_safe = (not p["feeds_boss_partner"] or len(played) == 3
                     or partner_has_it_locked)
        counters = [c for c in legal if card_points(c) > 0 and suit_of(c) != trump]
        if feed_safe and counters:
            return _highest(counters)
    non_trump = [c for c in legal if suit_of(c) != trump]
    return _cheapest(non_trump if non_trump else legal)

# ---------------------------------------------------------------------------
# Dispatcher — mirror of nextBotAction for the phases bots decide
# ---------------------------------------------------------------------------


def next_bot_action(g: Game, styles: list[str],
                    rng: random.Random | None = None) -> tuple:
    """Returns ('BID', seat, bid) | ('GODOWN', seat, cards) |
    ('TRUMP', seat, suit) | ('PLAY', seat, card). Deal/next-hand are the
    caller's job (they carry randomness / are structural)."""
    seat = g.turn
    style = styles[seat]
    if g.phase == BIDDING:
        if style == "random":
            r = rng or random
            if g.must_bid():
                return ("BID", seat, VALID_BIDS[0])
            floor = g.min_next_bid()
            bid = floor if floor is not None and r.random() < 0.25 else PASS
            return ("BID", seat, bid)
        return ("BID", seat, choose_bid(g, seat, style))
    if g.phase == WIDOW:
        if style == "random":
            r = rng or random
            picks = r.sample(g.hands[seat], 4)
            return ("GODOWN", seat, picks)
        trump = best_trump_suit(g.hands[seat])
        cards = choose_go_down(g.hands[seat], trump,
                               PERSONALITIES[style]["go_down_bury_penalty"])
        return ("GODOWN", seat, cards)
    if g.phase == TRUMP:
        if style == "random":
            r = rng or random
            return ("TRUMP", seat, r.choice(SUITS))
        return ("TRUMP", seat, best_trump_suit(g.hands[seat]))
    if g.phase == PLAYING:
        return ("PLAY", seat, choose_card(g, seat, style, rng))
    raise ValueError(f"no bot action in phase {PHASE_NAMES[g.phase]}")
