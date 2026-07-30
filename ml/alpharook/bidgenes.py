"""gen24 — the bid gym's genome: bidding strategy as 15 named, evolvable genes.

Rook is a bidding game (gen7's lesson, the par oracle's 28%, the blunder
detector's nightly evidence). But the previous gyms evolved neural weights
and learned mostly mirages. This gym takes the poker-book route instead:
the strategy space is a vector of INTERPRETABLE genes — an aggression
anchor, a jump tendency, a war stretch, a desperation dial — so when a
population converges we can simply READ what the equilibrium bidder does.
Card play never varies (everyone plays gen23 reflex); fitness differences
are pure bidding.

At the default gene values `genome_bid` reproduces rook.bots.choose_bid
(style "basic", the calibrated family bidder) EXACTLY — tested in
tests/test_bidgenes.py. Every deviation a city evolves is therefore a
legible delta from the family's own calibration. The four score-state
genes (deficit_slope / desperation / protection / cliff_fear) default to
zero because the family bidder is score-blind; whether score-aware bidding
wins in the -250/+500 format is the experiment.
"""

from __future__ import annotations

import hashlib
import json
import random

from rook.cards import PASS, SEATS, VALID_BIDS, team_of, partner_of
from rook.engine import Game
from rook.bots import estimate_tricks

# ---------------------------------------------------------------------------
# Gene specs: (lo, hi, sigma, default). Defaults reproduce family "basic":
# base 83 == family base 86 minus bid_cushion 3 (the two were redundant, so
# the cushion is folded into the anchor).
# ---------------------------------------------------------------------------

GENE_SPECS: dict[str, tuple[float, float, float, float]] = {
    # hand valuation: willingness = base + per_trick * (tricks + widow_hope)
    "base":          (70.0, 105.0, 2.0, 83.0),
    "per_trick":     (2.0, 12.0, 0.7, 6.0),
    "min_tricks":    (0.0, 3.0, 0.25, 0.8),   # junk filter: pass below this
    "widow_hope":    (-1.0, 1.5, 0.2, 0.0),   # phantom tricks credited to the widow
    # table talk
    "partner_boost": (0.0, 25.0, 2.0, 8.0),   # partner bid (and isn't high): add
    "partner_drag":  (0.0, 15.0, 1.5, 4.0),   # partner passed: subtract
    "overbid_margin": (0.0, 40.0, 3.0, 15.0),  # raise own partner only with this much room
    "war_stretch":   (0.0, 20.0, 2.0, 0.0),   # extra points vs an enemy high bid
    # tempo: crawl +5s vs jump bids
    "jump_gap":      (4.0, 60.0, 3.0, 20.0),  # jump only when comfort-floor >= this
    "jump_reserve":  (0.0, 20.0, 2.0, 5.0),   # points held back on a jump
    "jump_cap":      (85.0, 120.0, 4.0, 105.0),  # statement bids top out here
    # score geometry (the poker genes) — family defaults are score-blind
    "deficit_slope": (-0.06, 0.18, 0.02, 0.0),  # willingness per point behind
    "desperation":   (0.0, 30.0, 3.0, 0.0),   # stretch as the enemy nears +500
    "protection":    (-25.0, 25.0, 3.0, 0.0),  # +cautious / -closer as WE near +500
    "cliff_fear":    (0.0, 35.0, 3.0, 0.0),   # a set here would end the game at -250
}

GENE_NAMES = list(GENE_SPECS)


def default_genome() -> dict[str, float]:
    return {k: v[3] for k, v in GENE_SPECS.items()}


def random_genome(rng: random.Random) -> dict[str, float]:
    return {k: rng.uniform(lo, hi) for k, (lo, hi, _s, _d) in GENE_SPECS.items()}


def mutate(genome: dict[str, float], rng: random.Random,
           p: float = 0.35, sigma_scale: float = 1.0) -> dict[str, float]:
    child = dict(genome)
    for k, (lo, hi, sigma, _d) in GENE_SPECS.items():
        if rng.random() < p:
            child[k] = min(hi, max(lo, child[k] + rng.gauss(0, sigma * sigma_scale)))
    return child


def crossover(a: dict[str, float], b: dict[str, float],
              rng: random.Random) -> dict[str, float]:
    return {k: (a if rng.random() < 0.5 else b)[k] for k in GENE_SPECS}


def genome_id(genome: dict[str, float]) -> str:
    blob = json.dumps({k: round(genome[k], 4) for k in GENE_NAMES}, sort_keys=True)
    return hashlib.sha1(blob.encode()).hexdigest()[:8]


def describe(genome: dict[str, float]) -> str:
    """One line per gene that moved meaningfully off the family default."""
    lines = []
    for k, (_lo, _hi, sigma, d) in GENE_SPECS.items():
        delta = genome[k] - d
        if abs(delta) >= 0.75 * sigma:
            lines.append(f"{k} {genome[k]:.2f} ({delta:+.2f})")
    return ", ".join(lines) if lines else "≈ family basic"

# ---------------------------------------------------------------------------
# The decision function
# ---------------------------------------------------------------------------


def _snap_to_bid(points: float) -> int | None:
    best = None
    for b in VALID_BIDS:
        if b <= points:
            best = b
    return best


def situational_adjust(genome: dict[str, float], my_score: int, opp_score: int,
                       floor: int, win_score: int, lose_score: int) -> float:
    """Score-geometry shift in bid-points of willingness. Zero at defaults."""
    behind = opp_score - my_score
    adjust = max(-25.0, min(25.0, genome["deficit_slope"] * behind))
    if behind > 0:
        adjust += genome["desperation"] * max(0, opp_score) / win_score
    elif behind < 0:
        adjust -= genome["protection"] * max(0, my_score) / win_score
    if my_score - floor <= lose_score:
        # going set on this contract wouldn't just sting — it ends the game
        adjust -= genome["cliff_fear"]
    return adjust


def genome_bid(g: Game, seat: int, genome: dict[str, float]) -> int:
    """Returns PASS or a bid value from VALID_BIDS (always legal for the
    current auction state). Structure mirrors rook.bots.choose_bid; every
    constant is a gene."""
    if g.must_bid():
        return VALID_BIDS[0]
    floor = g.min_next_bid()
    if floor is None:
        return PASS

    tricks = estimate_tricks(g.hands[seat])
    if tricks < genome["min_tricks"]:
        return PASS

    partner = partner_of(seat)
    partner_bid = g.bids[partner]
    partner_has_high_bid = g.high_bid is not None and partner_bid == g.high_bid

    estimate = genome["base"] + genome["per_trick"] * (tricks + genome["widow_hope"])
    if partner_bid is not None and partner_bid != PASS and not partner_has_high_bid:
        estimate += genome["partner_boost"]
    elif partner_bid == PASS:
        estimate -= genome["partner_drag"]

    me = team_of(seat)
    estimate += situational_adjust(
        genome, g.scores[me], g.scores[1 - me], floor,
        g.win_score, g.lose_score)

    comfort = _snap_to_bid(estimate)
    if comfort is None:
        return PASS

    if partner_has_high_bid:
        opponents_alive = any(
            team_of(s) != me and g.bids[s] != PASS for s in SEATS)
        if not opponents_alive:
            return PASS  # family law: never raise your own locked contract
        return floor if floor + genome["overbid_margin"] <= comfort else PASS

    opponent_has_high_bid = g.high_bid is not None
    limit = comfort + (genome["war_stretch"] if opponent_has_high_bid else 0.0)
    if floor > limit:
        return PASS
    if comfort - floor >= genome["jump_gap"]:
        target = min(limit, comfort - genome["jump_reserve"], genome["jump_cap"])
        snapped = _snap_to_bid(target)
        return floor if snapped is None else max(floor, snapped)
    return floor
