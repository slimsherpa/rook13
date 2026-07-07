"""Card primitives, ported from src/lib/game/types.ts + deck.ts.

A card is an int 0..39: suit*10 + (number-5). Suits are indexed
0=Red, 1=Yellow, 2=Black, 3=Green (matching the TS trace encoding).
Seats are ints 0..3 = A1, B1, A2, B2; teams 0=A, 1=B.
"""

SUITS = (0, 1, 2, 3)
SUIT_NAMES = ("Red", "Yellow", "Black", "Green")
SEAT_NAMES = ("A1", "B1", "A2", "B2")
SEATS = (0, 1, 2, 3)
VALID_BIDS = (65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120)
CARDS_PER_PLAYER = 9
WIDOW_SIZE = 4
TRICKS_PER_HAND = 9
WIN_SCORE = 500
LOSE_SCORE = -250
TAKING_TRICKS_BONUS = 20

PASS = 0  # bid sentinel ('pass' in TS); real bids are >= 65


def suit_of(c: int) -> int:
    return c // 10


def num_of(c: int) -> int:
    return c % 10 + 5


def make_card(suit: int, number: int) -> int:
    return suit * 10 + (number - 5)


# card points: 5s worth 5, 10s and 13s worth 10
CARD_POINTS = tuple(
    5 if num_of(c) == 5 else 10 if num_of(c) in (10, 13) else 0 for c in range(40)
)


def card_points(c: int) -> int:
    return CARD_POINTS[c]


def team_of(seat: int) -> int:
    return seat % 2  # A1/A2 -> 0, B1/B2 -> 1


def partner_of(seat: int) -> int:
    return (seat + 2) % 4


def next_seat(seat: int) -> int:
    return (seat + 1) % 4


def create_deck() -> list[int]:
    return list(range(40))


def split_deal(deck: list[int]) -> tuple[list[list[int]], list[int]]:
    hands = [deck[i * CARDS_PER_PLAYER:(i + 1) * CARDS_PER_PLAYER] for i in range(4)]
    widow = deck[4 * CARDS_PER_PLAYER:4 * CARDS_PER_PLAYER + WIDOW_SIZE]
    return hands, widow


def is_redeal_hand(hand: list[int]) -> bool:
    """All 6s-9s — the celebrated redeal."""
    return len(hand) > 0 and all(6 <= num_of(c) <= 9 for c in hand)
