"""World sampling — port of src/lib/alpharook/determinize.ts.

Turns an Observation into complete, rules-consistent guesses about the
hidden cards: every sampled world places the unseen cards so that hand
sizes match the phase, nobody holds a suit they've already shown void in,
and any cards left over sit in the hidden widow/go-down.

Unlike the TS original (card play only), this version is phase-aware so
search can also imagine worlds mid-auction and mid-widow:

  bidding   -> others hold 9, four unseen cards are the face-down widow
  widow     -> the bid winner holds 13 (widow merged, nothing discarded)
  trump on  -> others hold 9; the go-down is hidden unless it's mine
  playing   -> hand sizes shrink with the tricks

v0 samples uniformly over consistent worlds. gen16 adds
`sample_world_weighted`: the same constraints, but each card lands where a
learned posterior says it lives ("she bid 100, she has trump") — the belief
head biasing the SAMPLER, not re-weighting worlds after the fact (both
re-weighting schemes tried in gen11 washed; see search.py).
"""

from __future__ import annotations

import random

from .cards import SEATS, suit_of
from .engine import BIDDING, WIDOW, TRUMP, PLAYING
from .observation import Observation, unseen_cards, known_voids, hand_sizes


def hidden_hand_sizes(o: Observation) -> dict[int, int]:
    """How many cards each OTHER seat is holding right now."""
    sizes: dict[int, int] = {}
    playing = o.phase >= PLAYING
    trick_sizes = hand_sizes(o) if playing else None
    for s in SEATS:
        if s == o.seat:
            continue
        if playing:
            sizes[s] = trick_sizes[s]
        elif o.phase == WIDOW and s == o.bid_winner:
            sizes[s] = 13  # widow merged, go-down not yet chosen
        else:
            sizes[s] = 9
    return sizes


def _solve_world(pool: list[int], slots: list[dict], rng: random.Random):
    """Exact fallback: backtracking assignment of the pool into slots. Since
    the real deal is always one consistent world, this cannot fail on a
    correct observation. Cards with the fewest eligible slots go first, and
    slot order is shuffled per card so repeated calls still sample varied
    worlds. Each slot: {"seat": int | None, "left": int, "banned": set}."""
    def eligible(c: int) -> int:
        return sum(1 for s in slots if suit_of(c) not in s["banned"])

    cards = sorted(pool, key=eligible)
    assignment: dict[int, dict] = {}

    def solve(idx: int) -> bool:
        if idx == len(cards):
            return True
        card = cards[idx]
        order = list(slots)
        rng.shuffle(order)
        for slot in order:
            if slot["left"] == 0 or suit_of(card) in slot["banned"]:
                continue
            slot["left"] -= 1
            assignment[card] = slot
            if solve(idx + 1):
                return True
            slot["left"] += 1
            del assignment[card]
        return False

    return assignment if solve(0) else None


def sample_world(o: Observation, rng: random.Random) -> tuple[list[list[int]], list[int]]:
    """One complete world consistent with what the observer knows.

    Returns (hands, go_down): full four-seat hands (the observer's own hand
    copied through) plus the four hidden cards — the face-down widow during
    bidding, or the go-down after it; the observer's own go-down if known.
    Fast path is rejection sampling against the void constraints; endgame
    squeezes fall back to the exact backtracking solver.
    """
    assert o.phase in (BIDDING, WIDOW, TRUMP, PLAYING), f"phase {o.phase}"
    pool = unseen_cards(o)
    sizes = hidden_hand_sizes(o)
    voids = known_voids(o)
    go_down_needed = len(pool) - sum(sizes.values())
    assert go_down_needed >= 0

    # most constrained seats first (most known voids)
    order = sorted(sizes.items(), key=lambda kv: -len(voids[kv[0]]))

    for _attempt in range(20):
        deck = list(pool)
        rng.shuffle(deck)
        hands: list[list[int] | None] = [None] * 4
        hands[o.seat] = list(o.hand)
        remaining = deck
        ok = True
        for seat, size in order:
            legal = [c for c in remaining if suit_of(c) not in voids[seat]]
            if len(legal) < size:
                ok = False
                break
            take = legal[:size]
            hands[seat] = take
            taken = set(take)
            remaining = [c for c in remaining if c not in taken]
        if not ok or len(remaining) != go_down_needed:
            continue
        go_down = list(o.my_go_down) if o.my_go_down else remaining
        return hands, go_down  # type: ignore[return-value]

    # greedy kept colliding — solve it exactly
    slots = [{"seat": seat, "left": size, "banned": set(voids[seat])}
             for seat, size in sizes.items()]
    slots.append({"seat": None, "left": go_down_needed, "banned": set()})
    solved = _solve_world(pool, slots, rng)
    if solved is None:
        raise ValueError("sample_world: observation is internally inconsistent")

    hands = [None] * 4
    hands[o.seat] = list(o.hand)
    for s in sizes:
        hands[s] = []
    go_down = list(o.my_go_down) if o.my_go_down else []
    for card, slot in solved.items():
        if slot["seat"] is None:
            go_down.append(card)
        else:
            hands[slot["seat"]].append(card)
    return hands, go_down  # type: ignore[return-value]


def sample_world_weighted(o: Observation, rng: random.Random, probs,
                          attempts: int = 30) -> tuple[list[list[int]], list[int]]:
    """One consistent world drawn from a learned posterior (gen16).

    `probs[card][cls]` is P(who holds `card`) in the belief-head convention:
    cls 0/1/2 = relative seats (s - o.seat) % 4 - 1, cls 3 = the hidden
    widow/go-down. Rows for cards the observer can see are ignored.

    Cards are placed one at a time in random order, each landing in an
    eligible slot (capacity left, no known void) with probability
    proportional to the posterior — so voids and hand sizes still bind
    exactly, and only genuinely ambiguous placements follow the net's
    imagination. Placement order is reshuffled per attempt; if the greedy
    fill corners itself repeatedly it falls back to the uniform sampler,
    which cannot fail."""
    assert o.phase in (BIDDING, WIDOW, TRUMP, PLAYING), f"phase {o.phase}"
    pool = unseen_cards(o)
    sizes = hidden_hand_sizes(o)
    voids = known_voids(o)
    go_down_needed = len(pool) - sum(sizes.values())
    assert go_down_needed >= 0
    rel = {s: (s - o.seat) % 4 - 1 for s in sizes}

    for _attempt in range(attempts):
        caps = dict(sizes)
        gd_left = go_down_needed
        placed: dict[int, list[int]] = {s: [] for s in sizes}
        go_down_pick: list[int] = []
        order = list(pool)
        rng.shuffle(order)
        ok = True
        for c in order:
            opts: list[int | None] = []
            wts: list[float] = []
            for s in sizes:
                if caps[s] > 0 and suit_of(c) not in voids[s]:
                    opts.append(s)
                    wts.append(max(float(probs[c][rel[s]]), 1e-6))
            if gd_left > 0:
                opts.append(None)
                wts.append(max(float(probs[c][3]), 1e-6))
            if not opts:
                ok = False
                break
            r = rng.random() * sum(wts)
            acc = 0.0
            pick = opts[-1]
            for opt, w in zip(opts, wts):
                acc += w
                if r < acc:
                    pick = opt
                    break
            if pick is None:
                gd_left -= 1
                go_down_pick.append(c)
            else:
                caps[pick] -= 1
                placed[pick].append(c)
        if ok:
            hands: list[list[int] | None] = [None] * 4
            hands[o.seat] = list(o.hand)
            for s in sizes:
                hands[s] = placed[s]
            go_down = list(o.my_go_down) if o.my_go_down else go_down_pick
            return hands, go_down  # type: ignore[return-value]

    return sample_world(o, rng)
