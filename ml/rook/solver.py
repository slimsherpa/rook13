"""THE ORACLE — exact perfect-information solver for a Rook13 hand.

Riley's AlphaGodRook, except it isn't trained: it's *computed*. With all
four hands face up, the value of a Rook hand is a finite game-tree search,
and Rook13 is small enough to solve outright — 9 tricks, 36 cards in play,
and only 12 of the 40 cards carry any points at all.

This is the double-dummy solver from bridge, adapted to Rook's scoring:
  * counters: 5s = 5, 10s = 10, 13s = 10        (100 pts across 4 suits)
  * the go-down goes to the team that wins the LAST trick
  * +20 to the team taking 5 of the 9 tricks
  => every deal is exactly 120 points, so the game is constant-sum and
     plain alpha-beta on team 0's total is sound.

WHAT THIS IS FOR (and what it is emphatically NOT for):

  It is a REFEREE. Par tells us how many points were actually available on
  a deal, so `par - what gen21 scored` measures how much was left on the
  table. It is also a low-variance evaluator to drop inside PIMC search in
  place of noisy rollouts.

  It is NOT a coach. Its choices are conditioned on the true deal, so
  cloning them teaches strategy fusion — finesses that only work because
  you peeked, bids that only make because the cards happen to lie well.
  See GENERATIONS.md law 9 and gen16's dead fork-search/plan-tree arms.
  The valid use is always to MARGINALIZE (average the oracle over the
  worlds a mortal considers possible), never to CONDITION on the truth.

API
    solve(hands, trump, leader, go_down_pts) -> team-0 points at par
    best_play(hands, trump, leader, go_down_pts) -> (card, team-0 points)
Both take `hands` as 4 lists (or bitmasks) of card ints, seat-indexed.
"""

from __future__ import annotations

from .cards import CARD_POINTS, TAKING_TRICKS_BONUS, num_of, suit_of, team_of

TOTAL_POINTS = 120          # 100 in counters + the 20-point trick bonus
_RANK = tuple(c % 10 for c in range(40))          # 0..9, higher = stronger
_SUIT = tuple(c // 10 for c in range(40))
_BIT = tuple(1 << c for c in range(40))
_SUIT_MASK = tuple(sum(_BIT[s * 10 + r] for r in range(10)) for s in range(4))
# cards of suit s strictly above rank r
_ABOVE = tuple(tuple(sum(_BIT[s * 10 + k] for k in range(r + 1, 10))
                     for r in range(10)) for s in range(4))


def _to_mask(h) -> int:
    return h if isinstance(h, int) else sum(_BIT[c] for c in h)


def _cards(mask: int) -> list[int]:
    out = []
    while mask:
        b = mask & -mask
        out.append(b.bit_length() - 1)
        mask ^= b
    return out


def _beats(card: int, best: int, trump, lead: int) -> bool:
    """Does `card` beat the current best card of the trick?"""
    c_tr = trump is not None and _SUIT[card] == trump
    b_tr = trump is not None and _SUIT[best] == trump
    if c_tr != b_tr:
        return c_tr
    # same trumpiness: only a higher card of the SAME suit can take over,
    # and a non-lead non-trump discard can never win (engine's rule)
    if _SUIT[card] != _SUIT[best]:
        return False
    return _RANK[card] > _RANK[best]


def _legal(hand: int, lead) -> int:
    if lead is None:
        return hand
    follow = hand & _SUIT_MASK[lead]
    return follow if follow else hand


# points depend only on the rank index: 5s (rank 0), 10s (rank 5), 13s (rank 8)
_RANK_PTS = tuple(5 if r == 0 else 10 if r in (5, 8) else 0 for r in range(10))


def _candidates(legal: int, live: int, trump=None) -> list[int]:
    """Legal plays with EQUIVALENT cards collapsed.

    Two cards of the same suit that are worth the same points and have no
    card still in anyone's hand between them are interchangeable — playing
    either leaves a position identical up to renaming. Trying one
    representative per run is exact, and it is where most of the speed
    comes from (Rook has 28 pointless cards, so the runs are long).

    Pure integer arithmetic on 10-bit per-suit rank masks: this is the
    hottest function in the solver, called at every node.
    """
    out = []
    for s in range(4):
        sub = (legal >> (s * 10)) & 0x3FF
        if not sub:
            continue
        lv = (live >> (s * 10)) & 0x3FF
        base = s * 10
        keep = -1
        for r in range(9, -1, -1):
            if not (sub >> r) & 1:
                continue
            if keep >= 0 and _RANK_PTS[r] == _RANK_PTS[keep] and not (
                    lv & ((1 << keep) - (1 << (r + 1)))):
                keep = r          # same run: extend it, emit nothing
                continue
            out.append(base + r)
            keep = r
    # high cards first — they decide tricks, so they prune best
    out.sort(key=lambda c: (_SUIT[c] == trump, _RANK[c]), reverse=True)
    return out


class _Solver:
    __slots__ = ("trump", "gd", "tt", "nodes", "n_tricks", "bonus_at",
                 "bonus", "cand")

    def __init__(self, trump, go_down_pts: int, n_tricks: int = 9,
                 bonus_at: int = 5, bonus: int = TAKING_TRICKS_BONUS):
        self.trump = trump
        self.gd = go_down_pts
        self.n_tricks = n_tricks
        self.bonus_at = bonus_at
        self.bonus = bonus
        self.tt: dict = {}
        self.cand: dict = {}
        self.nodes = 0

    def go(self, hands, turn, t0_tricks, tricks_done, alpha, beta,
           trick=()):
        """Team-0 points still to be won from here (excludes points already
        banked, which is what makes transposition entries reusable)."""
        self.nodes += 1
        if tricks_done == self.n_tricks:
            return self.bonus if t0_tricks >= self.bonus_at else 0

        key = (hands, turn, trick, t0_tricks)
        prev = None
        hit = self.tt.get(key)
        if hit is not None:
            lo, hi, prev = hit
            if lo == hi:
                return lo
            if lo >= beta:
                return lo
            if hi <= alpha:
                return hi
            alpha = max(alpha, lo)
            beta = min(beta, hi)
        a0, b0 = alpha, beta

        lead = _SUIT[trick[0][1]] if trick else None
        live = hands[0] | hands[1] | hands[2] | hands[3]
        ckey = (hands[turn], live, lead)
        moves = self.cand.get(ckey)
        if moves is None:
            moves = _candidates(_legal(hands[turn], lead), live, self.trump)
            self.cand[ckey] = moves
        # A move that was best here in an earlier (narrower) search jumps
        # the queue: refuting first is what makes zero-window passes cheap.
        # NB: `moves` is the cached list — never mutate it in place.
        if prev is not None and moves[0] != prev:
            moves = [prev] + [m for m in moves if m != prev]

        maxing = team_of(turn) == 0
        best = -1 if maxing else TOTAL_POINTS + 1
        best_mv = None
        for c in moves:
            nh = list(hands)
            nh[turn] &= ~_BIT[c]
            nh = tuple(nh)
            ntrick = trick + ((turn, c),)

            if len(ntrick) < 4:
                v = self.go(nh, (turn + 1) % 4, t0_tricks, tricks_done,
                            alpha, beta, ntrick)
            else:
                # resolve the trick
                w_seat, w_card = ntrick[0]
                for seat, card in ntrick[1:]:
                    if _beats(card, w_card, self.trump, lead):
                        w_seat, w_card = seat, card
                pts = sum(CARD_POINTS[card] for _, card in ntrick)
                won0 = team_of(w_seat) == 0
                gained = pts if won0 else 0
                if tricks_done == self.n_tricks - 1 and won0:
                    gained += self.gd          # go-down to the last trick
                v = gained + self.go(
                    nh, w_seat, t0_tricks + won0, tricks_done + 1,
                    alpha - gained, beta - gained)

            if maxing:
                if v > best:
                    best, best_mv = v, c
                if best > alpha:
                    alpha = best
                if alpha >= beta:
                    break
            else:
                if v < best:
                    best, best_mv = v, c
                if best < beta:
                    beta = best
                if alpha >= beta:
                    break

        # store a bound, or the exact value when the window didn't clip it
        lo = best if best > a0 else 0
        hi = best if best < b0 else TOTAL_POINTS
        self.tt[key] = (lo, hi, best_mv)
        return best


def _setup(hands, trump, go_down_pts, tricks_done, trick, bonus_at, bonus):
    h = tuple(_to_mask(x) for x in hands)
    played = {seat for seat, _ in trick}
    n_tricks = tricks_done + max(
        bin(h[s]).count("1") + (1 if s in played else 0) for s in range(4))
    return h, _Solver(trump, go_down_pts, n_tricks, bonus_at, bonus)


def solve(hands, trump, leader: int, go_down_pts: int = 0, *,
          t0_tricks: int = 0, tricks_done: int = 0, trick: tuple = (),
          bonus_at: int = 5, bonus: int = TAKING_TRICKS_BONUS) -> int:
    """Team 0's points from HERE to the end under perfect play by both
    teams (points already banked are the caller's to add).

    Works mid-hand: pass the tricks already completed, team 0's trick count
    so far, and any cards already on the table this trick.
    """
    h, s = _setup(hands, trump, go_down_pts, tricks_done, trick,
                  bonus_at, bonus)
    turn = (trick[-1][0] + 1) % 4 if trick else leader
    return _binary(s, h, turn, t0_tricks, tricks_done, trick,
                   go_down_pts, bonus)


def _binary(s, h, turn, t0_tricks, tricks_done, trick, gd, bonus):
    """Zero-window binary search on the value — the trick that makes
    double-dummy solvers fast. A wide-window search has to establish the
    exact score everywhere; a zero-window search only ever answers "is it
    at least X?", which prunes far harder. Every pass shares one
    transposition table, so the bounds compound across passes.
    """
    on_table = sum(CARD_POINTS[c] for c in _cards(h[0] | h[1] | h[2] | h[3]))
    on_table += sum(CARD_POINTS[c] for _, c in trick)
    hi_v = on_table + gd + bonus
    step = 5 if (gd % 5 == 0 and bonus % 5 == 0) else 1
    lo_k, hi_k = 0, hi_v // step
    while lo_k < hi_k:
        mid = ((lo_k + hi_k + 1) // 2) * step
        v = s.go(h, turn, t0_tricks, tricks_done, mid - 1, mid, trick)
        if v >= mid:
            lo_k = mid // step
        else:
            hi_k = mid // step - 1
    return lo_k * step


def best_play(hands, trump, leader: int, go_down_pts: int = 0, *,
              t0_tricks: int = 0, tricks_done: int = 0, trick: tuple = (),
              bonus_at: int = 5, bonus: int = TAKING_TRICKS_BONUS):
    """(card, team-0 points from here) for the seat to play. Root-level
    move loop so we can report WHICH card is optimal, not just the value —
    this is what the blunder audit needs."""
    vals = play_values(hands, trump, leader, go_down_pts,
                       t0_tricks=t0_tricks, tricks_done=tricks_done,
                       trick=trick, bonus_at=bonus_at, bonus=bonus)
    turn = (trick[-1][0] + 1) % 4 if trick else leader
    pick = (max if team_of(turn) == 0 else min)(vals, key=vals.get)
    return pick, vals[pick]


def play_values(hands, trump, leader: int, go_down_pts: int = 0, *,
                t0_tricks: int = 0, tricks_done: int = 0, trick: tuple = (),
                bonus_at: int = 5, bonus: int = TAKING_TRICKS_BONUS,
                only=None):
    """{card: exact team-0 points from here} for EVERY legal play.

    This is what the blunder audit wants: not just the best card but the
    exact cost of each alternative, so "how much did that play give away"
    is a measured number instead of a rollout estimate. Equivalent cards
    are collapsed, so only one representative of a run is reported.
    """
    h, s = _setup(hands, trump, go_down_pts, tricks_done, trick,
                  bonus_at, bonus)
    turn = (trick[-1][0] + 1) % 4 if trick else leader
    lead = _SUIT[trick[0][1]] if trick else None
    opts = _candidates(_legal(h[turn], lead), h[0] | h[1] | h[2] | h[3])
    if only is not None:
        want = set(only)
        # an excluded card may be the collapsed twin of a kept one; fall
        # back to the raw legal set so a specific card is always priceable
        opts = [c for c in opts if c in want] or [
            c for c in _cards(_legal(h[turn], lead)) if c in want]
    out = {}
    for c in opts:
        nh = list(h)
        nh[turn] &= ~_BIT[c]
        nh = tuple(nh)
        ntrick = trick + ((turn, c),)
        if len(ntrick) < 4:
            out[c] = _binary(s, nh, (turn + 1) % 4, t0_tricks, tricks_done,
                             ntrick, go_down_pts, bonus)
        else:
            ld = _SUIT[ntrick[0][1]]
            w_seat, w_card = ntrick[0]
            for seat, card in ntrick[1:]:
                if _beats(card, w_card, trump, ld):
                    w_seat, w_card = seat, card
            won0 = team_of(w_seat) == 0
            gained = sum(CARD_POINTS[x] for _, x in ntrick) if won0 else 0
            if tricks_done == s.n_tricks - 1 and won0:
                gained += go_down_pts
            out[c] = gained + _binary(
                s, nh, w_seat, t0_tricks + won0, tricks_done + 1, (),
                go_down_pts, bonus)
    return out


def card_name(c: int) -> str:
    return f"{'RYBG'[suit_of(c)]}{num_of(c)}"
