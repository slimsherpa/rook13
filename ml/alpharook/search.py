"""AlphaRook gen11: the champion net inside PIMC search.

Instinct x calculation — the AlphaZero recipe, closing the original roadmap.
The pure net (gen10) answers "what does this position feel like" in one
forward pass; this module multiplies that by actual look-ahead: for every
candidate action it imagines K complete worlds consistent with the
observation (determinize), plays each world out to the end of the hand with
the NET making every remaining decision for all four seats, and picks the
action whose average outcome is best.

The searching seat still sees only its Observation — worlds are sampled
from public information, so the no-omniscience contract holds (the leak
test scrambles hidden cards and asserts identical search decisions).

Speed comes from the same trick as training: all K x |candidates| rollouts
advance in lockstep and every pending (state, action) row across all of
them goes through the net in ONE forward pass per step. Forced moves
(singleton candidate sets) are fast-forwarded without touching the net.
"""

from __future__ import annotations

import math
import random

import numpy as np
import torch

from rook.cards import PASS, team_of
from rook.determinize import sample_world
from rook.engine import (
    Game, BIDDING, WIDOW, TRUMP, PLAYING, HAND_DONE, GAME_OVER,
)
from rook.cards import SUITS, VALID_BIDS
from rook.observation import Observation, observe
from .encoder import (
    encode_state, encode_action, D_BID, D_DISCARD, D_TRUMP, D_PLAY,
)


def materialize(o: Observation, hands: list[list[int]], go_down: list[int],
                win_score: int, lose_score: int) -> Game:
    """Fuse an Observation with one sampled world into a playable engine
    state. Mid-auction the world's hidden four cards are the face-down
    widow; from the widow phase on they are the go-down."""
    g = Game(dealer=o.dealer, win_score=win_score, lose_score=lose_score)
    g.phase = o.phase
    g.hand_number = o.hand_number
    g.turn = o.turn
    g.hands = [list(h) for h in hands]
    g.bids = list(o.bids)
    g.high_bid = o.high_bid
    g.scores = list(o.scores)
    g.tricks_won = list(o.tricks_won)
    g.points_taken = list(o.points_taken)
    g.trick_plays = list(o.trick_plays)
    g.trick_leader = o.trick_leader
    g.completed_tricks = list(o.completed_tricks)
    if o.phase == BIDDING:
        g.widow = list(go_down)
        g.go_down = []
        g.bid_winner = None
        g.trump = None
    else:
        g.widow = []
        # during the widow phase nothing has been discarded yet, so the
        # sampled bucket is empty there; from trump on it's the go-down
        g.go_down = list(go_down)
        g.bid_winner = o.bid_winner
        g.trump = o.trump
    return g


class _Sim:
    """One rollout: the env.py decision stream over a materialized game,
    stopping at the end of the CURRENT hand instead of dealing the next.
    Tracks the same private widow state as SelfPlayGame (pending discard
    picks + declared trump intent, auto-applied at the trump phase)."""

    __slots__ = ("g", "picks", "trump_intent")

    def __init__(self, g: Game, picks: list[int], trump_intent: int | None):
        self.g = g
        self.picks = list(picks)
        self.trump_intent = trump_intent
        self._advance()

    @property
    def hand_over(self) -> bool:
        return self.g.phase in (HAND_DONE, GAME_OVER)

    def _advance(self) -> None:
        g = self.g
        if g.phase == TRUMP and self.trump_intent is not None:
            g.select_trump(g.turn, self.trump_intent)
            self.trump_intent = None

    def decision(self) -> tuple[int, int, list]:
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
                return seat, D_TRUMP, list(SUITS)
            hand = g.hands[seat]
            return seat, D_DISCARD, [c for c in hand if c not in self.picks]
        if g.phase == TRUMP:
            return seat, D_TRUMP, list(SUITS)
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
                return
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


def rollout_value(g: Game, my_team: int) -> float:
    """What one finished rollout hand is worth, on the same scale the net
    was trained to predict: 0.5 * clipped hand diff + 0.5 * game term.
    Mid-game the win/loss part of the game term is unknown and drops out
    (identical comparisons across candidates); a hand that ENDS the game
    keeps it, so search bids protectively at 460 and desperately at -190."""
    h = g.hand_history[-1]
    diff = (h[4] - h[5]) if my_team == 0 else (h[5] - h[4])
    hand = max(-1.0, min(1.0, diff / 200.0))
    sd = g.scores[my_team] - g.scores[1 - my_team]
    game = 0.3 * max(-1.0, min(1.0, sd / g.win_score))
    if g.phase == GAME_OVER:
        game += 0.7 * (1.0 if g.winner == my_team else -1.0)
    return 0.5 * hand + 0.5 * game


class SearchAgent:
    """PIMC with the champion net as the everything-policy.

    worlds: consistent worlds sampled per searched decision.
    search_dtypes: which decisions get search (default: bids, trump intent,
        card play — go-down picks stay pure-net; searching 4 sequential
        picks x ~13 candidates costs more than it returns).
    max_bid_cands: wide auctions are pruned to PASS + the floor + the net's
        top-ranked raises before rollouts (priors prune the tree).
    prior_weight: Bayesian shrinkage toward the net's own Q. Raw argmax over
        K noisy rollout means suffers the winner's curse — it systematically
        picks the highest-VARIANCE action (a big bid) over the highest-value
        one; the first K=8 duel over-bid its way to 5% vs pure gen10. Scoring
        (rollout_sum + w * Q) / (K + w) treats the champion's calibrated
        instinct as w pseudo-rollouts, so search only overrides the net when
        the evidence is real. Q and rollout_value share the same target
        scale by construction.
    min_trick: only search card plays from this trick on (0 = all). PIMC is
        sharpest late in the hand — voids known, few unseen cards — while
        diffuse early positions are where uniform world-sampling misleads
        (the net's instinct implicitly knows "she bid 105, she has trump";
        uniform worlds don't). Early plays stay pure reflex.
    bid_infer: auction-aware imagination (sigma in bid points; 0 = off).
        Worlds are weighted by how well each hidden seat's sampled cards
        explain their AUCTION behavior, using the family's calibrated
        strength model: the declarer's kept nine must plausibly support the
        bid they announced, and every seat that passed must plausibly have
        declined the final contract. "She bid 105, deal her hands that
        would" — the partner/opponent model Riley asked for, at the
        cheapest possible altitude (no net forwards, pure arithmetic).
    infer_temp: learned inference — the net biases its own imagination.
        Worlds are importance-weighted by how plausibly the net (which IS
        the opponent in champion duels) would have made the plays actually
        observed this hand: weight = prod over hidden seats' past plays of
        softmax(Q / infer_temp)[observed card] inside that world. Uniform
        sampling (0 = off) imagines card placements the table's own play
        already rules out; this recovers the posterior the reflex net had
        implicitly learned, world by world.
    """

    def __init__(self, net, device: str = "cpu", worlds: int = 12,
                 search_dtypes: frozenset = frozenset({D_BID, D_TRUMP, D_PLAY}),
                 max_bid_cands: int = 6, prior_weight: float = 4.0,
                 min_trick: int = 0, infer_temp: float = 0.0,
                 bid_infer: float = 0.0, seed: int = 0):
        self.net = net
        self.device = device
        self.worlds = worlds
        self.search_dtypes = search_dtypes
        self.max_bid_cands = max_bid_cands
        self.prior_weight = prior_weight
        self.min_trick = min_trick
        self.infer_temp = infer_temp
        self.bid_infer = bid_infer
        self.rng = random.Random(seed)
        net.eval()

    # --- one-forward-pass helpers -------------------------------------

    def _q_values(self, state: np.ndarray, dtype: int, cands: list) -> np.ndarray:
        S = torch.from_numpy(np.stack([state] * len(cands))).to(self.device)
        A = torch.from_numpy(
            np.stack([encode_action(dtype, a) for a in cands])).to(self.device)
        return self.net(S, A).cpu().numpy()

    def _net_choose(self, env, seat: int, dtype: int, cands: list):
        s = encode_state(observe(env.g, seat), env.picks, dtype, env.g,
                         env.trump_intent)
        q = self._q_values(s, dtype, cands)
        # distillation taps: reflex decisions expose gen10's own Q so a
        # student can be anchored on the decisions search never touches
        self.last_reflex = (s, dtype, list(cands), [float(v) for v in q])
        return cands[int(np.argmax(q))]

    def _prune_bids(self, env, seat: int, cands: list) -> list:
        if len(cands) <= self.max_bid_cands:
            return cands
        s = encode_state(observe(env.g, seat), env.picks, D_BID, env.g,
                         env.trump_intent)
        q = self._q_values(s, D_BID, cands)
        keep = {i for i, a in enumerate(cands) if a == PASS}
        keep.add(min((i for i, a in enumerate(cands) if a != PASS),
                     key=lambda i: cands[i]))  # the minimum raise
        for i in np.argsort(-q):
            if len(keep) >= self.max_bid_cands:
                break
            keep.add(int(i))
        return [a for i, a in enumerate(cands) if i in keep]

    # --- auction inference: weight worlds by what the bidding announced --

    def _bid_log_weights(self, o: Observation,
                         worlds: list[tuple[list[list[int]], list[int]]]
                         ) -> np.ndarray:
        """log weight per world from the auction. For each hidden seat,
        rebuild the hand they held (current sampled cards + what they've
        played this hand — exact for non-declarers; the declarer's kept
        nine is judged against their bid directly) and score it with the
        family's calibrated point model:

          bid winner announced b  -> P(strength supports b)
          seat passed             -> P(strength below the final contract)

        Sigmoid steepness = bid_infer (in bid points)."""
        from rook.bots import _expected_points
        sigma = self.bid_infer
        played: list[list[int]] = [[], [], [], []]
        for _, plays, _, _ in o.completed_tricks:
            for s, c in plays:
                played[s].append(c)
        for s, c in o.trick_plays:
            played[s].append(c)

        n = len(worlds)
        log_w = np.zeros(n)
        if o.high_bid is None:
            return log_w
        def log_sigmoid(z: float) -> float:
            return -math.log1p(math.exp(-max(-30.0, min(30.0, z))))

        for wi, (hands, _gd) in enumerate(worlds):
            lw = 0.0
            for s in range(4):
                b = o.bids[s]
                if s == o.seat or b is None:
                    continue  # my own hand is known; silent seats said nothing
                strength = _expected_points(hands[s] + played[s], 0)
                if s == o.bid_winner:
                    # their kept hand should carry the contract they called
                    lw += log_sigmoid((strength + 5.0 - o.high_bid) / sigma)
                else:
                    # they declined to outbid the final contract...
                    lw += log_sigmoid((o.high_bid + 5.0 - strength) / sigma)
                    if b != PASS:
                        # ...but showed real strength before folding
                        lw += log_sigmoid((strength + 5.0 - b) / sigma)
            log_w[wi] = lw
        return log_w

    # --- learned inference: weight worlds by the observed play history --

    def _world_log_weights(self, o: Observation,
                           worlds: list[tuple[list[list[int]], list[int]]],
                           win_score: int, lose_score: int) -> np.ndarray:
        """log importance weight per world: replay this hand's public play
        sequence inside the world and score each hidden seat's observed card
        under softmax(Q / temp) over their legal options there."""
        all_plays = [p for _, plays, _, _ in o.completed_tricks
                     for p in plays] + list(o.trick_plays)
        n = len(worlds)
        log_w = np.zeros(n)
        if not all_plays or o.trump is None:
            return log_w

        rows_s, rows_a, seg, meta = [], [], [0], []
        for wi, (hands, go_down) in enumerate(worlds):
            # rewind to trick one: current holdings + what each seat played
            init = [list(h) for h in hands]
            for s, c in all_plays:
                init[s].append(c)
            g = Game(dealer=o.dealer, win_score=win_score,
                     lose_score=lose_score)
            g.phase = PLAYING
            g.hand_number = o.hand_number
            g.hands = init
            g.bids = list(o.bids)
            g.high_bid = o.high_bid
            g.bid_winner = o.bid_winner
            g.trump = o.trump
            g.go_down = list(go_down)
            g.scores = list(o.scores)
            first_leader = (o.completed_tricks[0][0] if o.completed_tricks
                            else o.trick_leader)
            g.trick_leader = first_leader
            g.turn = first_leader
            for s, c in all_plays:
                cands = g.legal_cards(s)
                if s != o.seat and len(cands) > 1:
                    st = encode_state(observe(g, s), [], D_PLAY, g, None)
                    for a in cands:
                        rows_s.append(st)
                        rows_a.append(encode_action(D_PLAY, a))
                    seg.append(seg[-1] + len(cands))
                    meta.append((wi, cands.index(c)))
                g.play_card(s, c)

        if not meta:
            return log_w
        S = torch.from_numpy(np.stack(rows_s)).to(self.device)
        A = torch.from_numpy(np.stack(rows_a)).to(self.device)
        q = self.net(S, A).cpu().numpy()
        for k, (wi, obs_idx) in enumerate(meta):
            z = q[seg[k]:seg[k + 1]] / self.infer_temp
            z -= z.max()
            log_w[wi] += z[obs_idx] - np.log(np.exp(z).sum())
        return log_w

    # --- the search ----------------------------------------------------

    @torch.no_grad()
    def choose(self, env, seat: int, dtype: int, cands: list):
        # distillation taps, refreshed per decision: last_search carries the
        # blended per-candidate scores of a searched decision, last_reflex
        # the bare-net Q of an unsearched one (see distill.py)
        self.last_search = None
        self.last_reflex = None
        if len(cands) == 1:
            return cands[0]
        if dtype not in self.search_dtypes:
            return self._net_choose(env, seat, dtype, cands)
        if (dtype == D_PLAY and self.min_trick > 0
                and len(env.g.completed_tricks) < self.min_trick):
            return self._net_choose(env, seat, dtype, cands)
        if dtype == D_BID:
            cands = self._prune_bids(env, seat, cands)
            if len(cands) == 1:
                return cands[0]

        o = observe(env.g, seat)
        my_team = team_of(seat)
        totals = [0.0] * len(cands)
        root_state = encode_state(o, env.picks, dtype, env.g, env.trump_intent)
        prior = self._q_values(root_state, dtype, cands)

        # imagine K worlds; with inference on, weight them by how well they
        # explain what everyone has already announced (auction) and played
        worlds = [sample_world(o, self.rng) for _ in range(self.worlds)]
        lw = np.zeros(self.worlds)
        if self.bid_infer > 0 and o.trump is not None:
            lw += self._bid_log_weights(o, worlds)
        if self.infer_temp > 0:
            lw += self._world_log_weights(o, worlds,
                                          env.g.win_score, env.g.lose_score)
        if lw.any():
            lw -= lw.max()
            wts = np.exp(lw)
            wts *= self.worlds / wts.sum()  # total evidence mass stays K
        else:
            wts = np.ones(self.worlds)

        # spawn K x |cands| rollouts: same world across candidates, so the
        # comparison inside each imagined world is apples to apples
        pending: list[tuple[int, float, _Sim]] = []
        for k, (hands, go_down) in enumerate(worlds):
            for ci, a in enumerate(cands):
                g = materialize(o, hands, go_down,
                                env.g.win_score, env.g.lose_score)
                sim = _Sim(g, env.picks, env.trump_intent)
                sim.apply(a)
                pending.append((ci, float(wts[k]), sim))

        # lockstep: every step, one batched forward over all live rollouts
        while pending:
            rows_s, rows_a, meta, seg = [], [], [], [0]
            still: list[tuple[int, float, _Sim]] = []
            for ci, wt, sim in pending:
                while True:
                    if sim.hand_over:
                        totals[ci] += wt * rollout_value(sim.g, my_team)
                        break
                    s2, dt, cs = sim.decision()
                    if len(cs) == 1:
                        sim.apply(cs[0])
                        continue
                    st = encode_state(observe(sim.g, s2), sim.picks, dt,
                                      sim.g, sim.trump_intent)
                    for a in cs:
                        rows_s.append(st)
                        rows_a.append(encode_action(dt, a))
                    seg.append(seg[-1] + len(cs))
                    meta.append((sim, cs))
                    still.append((ci, wt, sim))
                    break
            if not meta:
                break
            S = torch.from_numpy(np.stack(rows_s)).to(self.device)
            A = torch.from_numpy(np.stack(rows_a)).to(self.device)
            q = self.net(S, A).cpu().numpy()
            for k, (sim, cs) in enumerate(meta):
                lo, hi = seg[k], seg[k + 1]
                sim.apply(cs[int(np.argmax(q[lo:hi]))])
            pending = still

        w = self.prior_weight
        score = [(totals[i] + w * float(prior[i])) / (self.worlds + w)
                 for i in range(len(cands))]
        self.last_search = (root_state, dtype, list(cands), score)
        return cands[int(np.argmax(score))]
