"""The gen24 genome contract: at default genes, genome_bid IS the family
calibrated bidder — and at any genes, it never returns an illegal action.

The equivalence test is what makes evolved genomes legible: every gene
delta a city reports is a delta from the family's own calibration, not
from some arbitrary re-implementation.
"""

import random

from rook.cards import PASS, VALID_BIDS, create_deck, split_deal
from rook.engine import Game, BIDDING, GAME_OVER
from rook.bots import choose_bid
from alpharook.bidgenes import (
    default_genome, random_genome, mutate, crossover, genome_bid,
)


def _auction_states(seed: int, n_deals: int, scores=(0, 0)):
    """Yield (game, seat_to_act) at every point of many simulated auctions,
    with the auction driven by a mix of scripted actions so genome turns see
    diverse floors / partner situations."""
    rng = random.Random(seed)
    for _ in range(n_deals):
        g = Game(dealer=rng.randrange(4))
        g.scores = list(scores)
        deck = create_deck()
        rng.shuffle(deck)
        g.deal(deck)
        if g.phase != BIDDING:
            continue  # redeal hand — skip
        while g.phase == BIDDING:
            yield g, g.turn
            # drive with a random-but-legal action to diversify states
            floor = g.min_next_bid()
            if g.must_bid():
                g.bid(g.turn, VALID_BIDS[0])
            elif floor is None or rng.random() < 0.55:
                g.bid(g.turn, PASS)
            else:
                cands = [b for b in VALID_BIDS if b >= floor]
                g.bid(g.turn, rng.choice(cands[:3] + cands))


def test_default_genome_matches_family_basic():
    genome = default_genome()
    checked = 0
    for scores in [(0, 0), (300, 150), (-180, 420), (460, 440), (-200, 100)]:
        for g, seat in _auction_states(seed=hash(scores) & 0xFFFF,
                                       n_deals=150, scores=scores):
            assert genome_bid(g, seat, genome) == choose_bid(g, seat, "basic")
            checked += 1
    assert checked > 2000


def test_any_genome_is_always_legal():
    rng = random.Random(7)
    genomes = [random_genome(rng) for _ in range(12)]
    genomes += [mutate(crossover(genomes[0], genomes[1], rng), rng, p=1.0,
                       sigma_scale=3.0) for _ in range(6)]
    for i, genome in enumerate(genomes):
        for g, seat in _auction_states(seed=100 + i, n_deals=60,
                                       scores=(rng.randrange(-240, 480),
                                               rng.randrange(-240, 480))):
            a = genome_bid(g, seat, genome)
            floor = g.min_next_bid()
            if g.must_bid():
                assert a == VALID_BIDS[0]
            elif a == PASS:
                pass  # always legal unless must_bid
            else:
                assert a in VALID_BIDS and floor is not None and a >= floor


def test_full_games_with_wild_genomes_complete():
    """A table of four maximally-weird bidders must still produce finished,
    scoreable games (the engine asserts legality on every action)."""
    from rook.bots import next_bot_action
    rng = random.Random(99)
    for trial in range(8):
        genomes = [random_genome(rng) for _ in range(4)]
        g = Game(dealer=trial % 4)
        safety = 4000
        while g.phase != GAME_OVER and safety > 0:
            safety -= 1
            if g.phase in (0, 1):  # dealing / redeal
                deck = create_deck()
                rng.shuffle(deck)
                g.deal(deck)
            elif g.phase == BIDDING:
                g.bid(g.turn, genome_bid(g, g.turn, genomes[g.turn]))
            elif g.phase == 6:  # hand_done
                g.next_hand()
            else:
                kind, seat, val = next_bot_action(g, ["basic"] * 4, rng)
                if kind == "GODOWN":
                    g.select_go_down(seat, val)
                elif kind == "TRUMP":
                    g.select_trump(seat, val)
                else:
                    g.play_card(seat, val)
        assert g.phase == GAME_OVER and g.winner in (0, 1)
