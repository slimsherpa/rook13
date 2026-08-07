"""P1.3 — MORTALWIDOW: the anytime searcher pointed at the widow.

The biggest single decision in the hand — which 4 cards to bury and
what's trump, a 2,860-option menu — priced the same way MortalRook
prices a card: sample K opponent worlds from the belief posterior,
EXACT-solve the whole hand under each shortlisted (go-down, trump)
choice (C oracle, same worlds for every candidate), average in family
hand currency, and stop when the answer is obvious or the clock runs
out.

Shortlist (Reflex + the family's own theory + temperature-sampled
exploration, ~a dozen candidates; hindsight says 38.7% of contracts
could improve by a different burial — this prices what is KNOWABLY
reachable without hindsight):
  * the incumbent: the reflex net's own intent + greedy picks (what
    production plays today) — always in;
  * the family heuristic burial for each plausible trump suit;
  * the reflex's greedy burial for each plausible trump suit;
  * widowgym's candidate_menu samples (no strategy templates — Riley's
    v3 rule: smooth priors, not rulebooks).

Discipline (the MortalRook law, applied twice): selection on shared
worlds with anytime stops, then the SPLIT-SAMPLE confirm — a challenger
that beats the incumbent on the selection worlds must ALSO beat it on
fresh evaluation worlds by tau, or the incumbent stands. No prior blend
here (there is no calibrated Q over burial combos); the confirm pass IS
the winner's-curse guardrail.

Replay-reproducible exactly like anytime.py: per-decision seeds derive
from public state, world solves are node-budgeted, `last_widow["k"]`
records what the clock allowed.

Duck-types the duel agent interface: owns D_TRUMP-at-widow (runs the
search, returns the intent) and D_DISCARD (emits the cached picks);
every other decision — including card play — is delegated to the inner
agent (an AnytimeRookAgent for the full P1 stack, or reflex).
"""

from __future__ import annotations

import math
import time

import random

from rook.bots import best_trump_suit, choose_go_down
from rook.cards import SUITS, card_points, suit_of, team_of
from rook.engine import WIDOW, bid_lead
from rook.determinize import sample_world, sample_world_weighted
from rook.observation import observe
import os as _os
if _os.environ.get("ROOK_PURE_PY"):
    from rook import solver as S
    class _NoAbort(Exception):
        pass
    _SolveAbort = _NoAbort
else:
    try:
        from rook import csolver as S
        _SolveAbort = S.SolveAbort
    except Exception as _e:
        print(f"[mortalwidow] WARNING: C solver unavailable ({_e}); "
              f"falling back to PYTHON solver (~60x slower)", flush=True)
        from rook import solver as S
        class _NoAbort(Exception):
            pass
        _SolveAbort = _NoAbort

from .anytime import decision_seed
from .arena import model_choose
from .encoder import D_DISCARD, D_TRUMP, D_PLAY
from .mortalgod import hand_value
from .widowgym_data import candidate_menu

SHORTLIST_CAP = 12


class MortalWidowAgent:
    """budget_s: wall-clock budget for the whole widow decision (lab
    default is generous — this is an offline gate instrument first; the
    production clock gets set by the P1.3 verdict and P5).
    tau: family points a challenger burial must clear the incumbent by
    on FRESH evaluation worlds. eval_worlds: size of that confirm pass.
    world_nodes: per-solve node budget (a world is discarded for all
    candidates if ANY of its solves runs over — CRN preserved)."""

    def __init__(self, net, belief, play_agent=None,
                 budget_s: float = 60.0, z_stop: float = 2.2,
                 tau: float = 3.0, k_min: int = 8, k_max: int = 192,
                 eval_worlds: int = 24, world_nodes: int = 16_000_000,
                 menu_samples: int = 6, proposer=None, proposer_k: int = 4,
                 seed: int = 0):
        self.net = net
        self.belief = belief
        self.play_agent = play_agent
        self.budget_s = budget_s
        self.z_stop = z_stop
        self.tau = tau
        self.k_min = k_min
        self.k_max = k_max
        self.eval_worlds = eval_worlds
        self.world_nodes = world_nodes
        self.menu_samples = menu_samples
        # WidowProposer (the AlphaZero loop, serve side): rank the menu,
        # keep only the top proposer_k plus the incumbent. Trained on
        # the searcher's own valued menus; the Calculator still verifies.
        self.proposer = proposer
        self.proposer_k = proposer_k
        self.seed = seed
        self.last_search = None
        self.last_widow = None
        self._plan: list[int] | None = None
        # telemetry: [decisions, overrides, worlds, timeouts, secs]
        self.stats = [0, 0, 0, 0, 0.0]

    # --- shortlist ----------------------------------------------------

    def _greedy_reflex_burial(self, env, seat, trump) -> tuple:
        """The net's own 4 sequential picks under a fixed trump intent —
        exactly the question production asks it, per suit."""
        class _E:
            pass
        e = _E()
        e.g = env.g
        e.picks = []
        e.trump_intent = trump
        picks = []
        for _ in range(4):
            hand = e.g.hands[seat]
            cands = [c for c in hand if c not in picks]
            pick = model_choose(self.net, "cpu", e, seat, D_DISCARD, cands)
            picks.append(pick)
            e.picks = list(picks)
        return tuple(sorted(picks)), trump

    def _shortlist(self, env, seat) -> tuple[list, tuple]:
        hand13 = list(env.g.hands[seat])
        # the incumbent: reflex intent, then reflex greedy picks
        intent = model_choose(self.net, "cpu", env, seat, D_TRUMP,
                              list(SUITS))
        incumbent = self._greedy_reflex_burial(env, seat, intent)
        cands = {incumbent}
        # plausible trump suits: any longest suit + the heuristic's pick
        # + the reflex intent (dedup) — burials explore around each
        by_suit = {s: [c for c in hand13 if suit_of(c) == s] for s in SUITS}
        mx = max(len(v) for v in by_suit.values())
        suits = {s for s in SUITS if len(by_suit[s]) == mx}
        suits.add(intent)
        suits.add(best_trump_suit(hand13))
        for s in suits:
            cands.add((tuple(sorted(choose_go_down(hand13, s))), s))
            if s != intent:
                cands.add(self._greedy_reflex_burial(env, seat, s))
        for disc, tr in candidate_menu(hand13, list(incumbent[0]),
                                       incumbent[1],
                                       n_cands=self.menu_samples):
            cands.add((tuple(sorted(disc)), tr))
        out = list(cands)
        if len(out) > SHORTLIST_CAP:
            rng = random.Random(decision_seed(self.seed ^ 0x51D, env.g,
                                              seat))
            keep = [c for c in out if c == incumbent]
            rest = [c for c in out if c != incumbent]
            rng.shuffle(rest)
            out = keep + rest[:SHORTLIST_CAP - 1]
        return out, incumbent

    # --- pricing ------------------------------------------------------

    def _world_values(self, env, seat, o, cands, rng, probs):
        """One shared world: {(disc, trump): family value} or None if any
        solve ran over budget / sampling failed."""
        g0 = env.g
        try:
            if probs is not None:
                hands, _gd = sample_world_weighted(o, rng, probs)
            else:
                hands, _gd = sample_world(o, rng)
        except Exception:
            return None
        my_team = team_of(seat)
        bid_team = team_of(g0.bid_winner)
        bid = g0.high_bid
        out = {}
        for disc, trump in cands:
            keep = [c for c in g0.hands[seat] if c not in disc]
            hh = [list(h) for h in hands]
            hh[seat] = keep
            gd_pts = sum(card_points(c) for c in disc)
            leader = bid_lead(g0.dealer)
            try:
                pts0 = S.solve(hh, trump, leader, gd_pts,
                               node_budget=self.world_nodes)
            except _SolveAbort:
                return None
            out[(disc, trump)] = hand_value(pts0, bid_team, bid, my_team)
        return out

    def _widow_search(self, env, seat):
        t0 = time.time()
        g0 = env.g
        o = observe(g0, seat)
        cands, incumbent = self._shortlist(env, seat)
        if self.proposer is not None and len(cands) > self.proposer_k + 1:
            from .encoder import encode_state_for
            import numpy as _np
            s = encode_state_for(self.net, o, env.picks, D_TRUMP, g0,
                                 env.trump_intent)
            scores = self.proposer.rank(_np.asarray(s, dtype=_np.float32),
                                        cands)
            order = sorted(range(len(cands)), key=lambda i: -scores[i])
            keep = [cands[i] for i in order[:self.proposer_k]]
            if incumbent not in keep:
                keep.append(incumbent)
            cands = keep
        probs = None
        if self.belief is not None:
            try:
                probs = self.belief.posterior(env, seat, o, D_TRUMP,
                                              [incumbent[1]])
            except Exception:
                probs = None
        rng = random.Random(decision_seed(self.seed, g0, seat))
        deadline = t0 + self.budget_s

        sel = {c: [] for c in cands}
        k = 0
        timeouts = 0
        stop = "kmax"
        attempts = 0
        while k < self.k_max:
            if attempts >= self.k_max * 2 + 16:
                stop = "attempts"
                break
            if k >= self.k_min:
                means = {c: sum(v) / k for c, v in sel.items()}
                order = sorted(cands, key=lambda c: means[c], reverse=True)
                top, second = order[0], order[1]
                d = [a - b for a, b in zip(sel[top], sel[second])]
                mean_d = sum(d) / k
                var_d = sum(x * x for x in d) / k - mean_d * mean_d
                se = math.sqrt(max(0.0, var_d) / k)
                if se == 0.0 or mean_d > self.z_stop * se:
                    stop = "obvious"
                    break
                if time.time() >= deadline:
                    stop = "budget"
                    break
            attempts += 1
            wv = self._world_values(env, seat, o, cands, rng, probs)
            if wv is None:
                timeouts += 1
                continue
            for c in cands:
                sel[c].append(wv[c])
            k += 1

        if not k:
            choice = incumbent
            confirmed = 0
        else:
            means = {c: sum(v) / k for c, v in sel.items()}
            challenger = max(cands, key=lambda c: means[c])
            choice = incumbent
            confirmed = 0
            if challenger != incumbent:
                # split-sample confirm on FRESH worlds (the MortalRook law)
                ev = {challenger: [], incumbent: []}
                ke = 0
                while ke < self.eval_worlds and attempts < self.k_max * 3:
                    attempts += 1
                    wv = self._world_values(env, seat, o,
                                            [challenger, incumbent],
                                            rng, probs)
                    if wv is None:
                        timeouts += 1
                        continue
                    ev[challenger].append(wv[challenger])
                    ev[incumbent].append(wv[incumbent])
                    ke += 1
                if ke and (sum(ev[challenger]) / ke
                           - sum(ev[incumbent]) / ke) >= self.tau:
                    choice = challenger
                    confirmed = 1

        secs = time.time() - t0
        self.last_widow = dict(
            k=k, timeouts=timeouts, stop=stop, secs=round(secs, 2),
            n_cands=len(cands), overrode=int(choice != incumbent),
            confirmed=confirmed,
            incumbent=[list(incumbent[0]), incumbent[1]],
            choice=[list(choice[0]), choice[1]],
            seed=decision_seed(self.seed, g0, seat),
            # proposer training labels (2026-08-06): every shortlisted
            # burial with its selection-world mean value — the search's
            # homework, ready for the AlphaZero loop (search teaches the
            # proposer; the proposer will prune the search)
            cand_means=[[list(c[0]), c[1],
                         round(sum(sel[c]) / k, 2) if k else None]
                        for c in cands])
        self.stats[0] += 1
        self.stats[1] += int(choice != incumbent)
        self.stats[2] += k
        self.stats[3] += timeouts
        self.stats[4] += secs
        return choice

    # --- the agent interface ------------------------------------------

    def choose(self, env, seat, dtype, cands):
        self.last_search = None
        if dtype == D_TRUMP and env.g.phase == WIDOW \
                and env.trump_intent is None:
            disc, trump = self._widow_search(env, seat)
            self._plan = list(disc)
            return trump
        if dtype == D_DISCARD and self._plan:
            for c in self._plan:
                if c in cands:
                    self._plan.remove(c)
                    return c
            self._plan = None      # plan exhausted/stale: fall through
        if self.play_agent is not None:
            pick = self.play_agent.choose(env, seat, dtype, cands)
            self.last_search = self.play_agent.last_search
            return pick
        return model_choose(self.net, "cpu", env, seat, dtype, cands)
