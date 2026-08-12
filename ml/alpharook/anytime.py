"""P1.1 — THE ANYTIME SEARCHER (campaign charter, 2026-08-05).

The deal-solve-check loop: at every card decision, keep imagining worlds
(belief-sampled, observation-consistent) and exact-solving every
shortlisted candidate in each (C oracle, family hand currency), until one
of two stopping rules fires:

  OBVIOUS-CARD STOP — the top candidate is statistically separated from
    the runner-up on the SHARED worlds, judged with the Reflex prior
    blended in as pseudo-worlds. The blend is the guardrail that keeps
    early stopping from re-opening the winner's curse: a challenger only
    separates once its world evidence overcomes the champion's calibrated
    instinct, and the paired-difference test runs on common random
    numbers so deal luck cancels per world.

  BUDGET STOP — a wall-clock budget per decision, shaped by the P0
    think-time map: deepest on the opening lead (the measured wall),
    deep on trick-0 follows, tapering to a cap that late tricks never
    reach (their solves are ~1000x cheaper, so the same clock buys
    effectively unlimited worlds — adaptive K by design).

Plus the slow-tail tamer: every world's solve runs under a NODE budget
(deterministic, hardware-independent — csolver.SolveAbort). A world that
runs over is discarded for ALL candidates, so common-random-numbers
pairing survives and replays reproduce exactly.

Discipline carried forward from MortalRook (the confirmed +1.68 edge),
IN FULL — the first smoke duel (2026-08-06, 150 games) taught the
lesson again from the other side: replacing the split-sample confirm
with a heavy prior blend collapsed the override rate to 0.62/hand
(MortalRook: 1.5/hand; 2.2% of leads vs 26%) and LOST to flat-K48 by
5.6 pts/hand. The edge IS the overrides, and the discipline that makes
them honest is the two-phase one:

  SELECT on shared worlds (anytime: obvious-card stop + budget stop,
    a light Reflex prior in the stopping test only), then
  CONFIRM any challenger on FRESH evaluation worlds — it must beat the
    reflex incumbent by tau there, or the incumbent stands.

Reflex's shortlist (top CAND_CAP by Q, incumbent always in), and no
mid-search candidate cutting (Riley's lock): every shortlisted card is
priced in every counted selection world.

Replay reproducibility: the per-decision RNG is seeded from the PUBLIC
decision state (not a consumed stream), worlds and node-budget aborts
are deterministic, and `last_think["k"]` records how many worlds the
clock allowed. `replay(env, seat, dtype, cands, k)` re-runs any decision
bit-exactly from that k — the hook P1.4's interview audits build on.

Duck-types the duel agent interface (.choose, .last_search).
"""

from __future__ import annotations

import math
import random
import time

from rook.cards import team_of
from rook.determinize import sample_world, sample_world_weighted
from rook.observation import observe
import os as _os
if _os.environ.get("ROOK_PURE_PY"):
    from rook import solver as S
    class _NoAbort(Exception):
        pass
    _SolveAbort = _NoAbort          # pure-Python path has no node budget
else:
    try:
        from rook import csolver as S
        _SolveAbort = S.SolveAbort
    except Exception as _e:
        # LOUD fallback (hil-6 law, 2026-08-04): never hide a 60x slowdown
        print(f"[anytime] WARNING: C solver unavailable ({_e}); "
              f"falling back to PYTHON solver (~60x slower)", flush=True)
        from rook import solver as S
        class _NoAbort(Exception):
            pass
        _SolveAbort = _NoAbort

from .arena import model_choose
from .encoder import D_PLAY
from .mortalgod import hand_value
from .search import materialize

CAND_CAP = 6

# ROOK_THINK_LOG=path: append one JSON line per searched decision
# (pid-suffixed so duel workers never interleave). The smoke-duel
# analysis and the P1.4 interview audits both read this.
_THINK_LOG = _os.environ.get("ROOK_THINK_LOG")
_think_f = None


def _log_think(row: dict) -> None:
    global _think_f
    if not _THINK_LOG:
        return
    if _think_f is None:
        _think_f = open(f"{_THINK_LOG}.{_os.getpid()}", "a")
    import json
    _think_f.write(json.dumps(row) + "\n")
    _think_f.flush()

# P0 think-time map, cashed in as wall-clock budgets (seconds). Keys are
# (trick, is_lead); the opening lead is the measured wall (~8x any other
# trick-0 decision), late tricks are so cheap the budget never binds —
# there the obvious-card stop and K_MAX govern. Scaled by budget_scale.
BUDGET_MAP = {
    (0, True): 12.0,   # the opening lead — deepest think
    (0, False): 10.0,  # trick-0 follows — same clock buys ~8x the worlds
    (1, True): 8.0, (1, False): 8.0,
    (2, True): 6.0, (2, False): 6.0,
    (3, True): 4.0, (3, False): 4.0,
}
LATE_BUDGET = 3.0      # trick 4+ — effectively unlimited K at ~ms/world


def _mix64(x: int) -> int:
    """splitmix64 — the same mixer the C oracle uses for its TT keys."""
    x = (x + 0x9E3779B97F4A7C15) & 0xFFFFFFFFFFFFFFFF
    x = ((x ^ (x >> 30)) * 0xBF58476D1CE4E5B9) & 0xFFFFFFFFFFFFFFFF
    x = ((x ^ (x >> 27)) * 0x94D049BB133111EB) & 0xFFFFFFFFFFFFFFFF
    return x ^ (x >> 31)


def decision_seed(base: int, g, seat: int) -> int:
    """Deterministic per-decision seed derived from PUBLIC state only, so
    any process holding the same observation (lab replay, the P1.4
    service audit) derives the same worlds without sharing RNG streams."""
    x = _mix64(base & 0xFFFFFFFFFFFFFFFF)
    for v in (g.hand_number, len(g.completed_tricks), len(g.trick_plays),
              seat, g.high_bid or 0,
              -1 if g.trump is None else g.trump):
        x = _mix64(x ^ (v & 0xFFFFFFFFFFFFFFFF))
    for c in sorted(g.hands[seat]):
        x = _mix64(x ^ (c + 1))
    for s, c in g.trick_plays:
        x = _mix64(x ^ ((s << 8) | (c + 1)))
    return x


class AnytimeRookAgent:
    """The anytime MortalRook: adaptive-K belief-world exact solving with
    obvious-card and budget stops.

    net           Reflex — the champion QNet (shortlist, prior, incumbent,
                  and every non-play decision).
    belief        DayDream — BeliefOracle sampling the imagined worlds.
    budget_scale  multiplies the P0 budget map (1.0 = the 8-12s charter
                  clock; smoke tests use small values).
    z_stop        separation threshold in paired standard errors for the
                  obvious-card stop.
    tau           incumbent margin in family points on FRESH evaluation
                  worlds — MortalRook's confirmed bar, unchanged.
    prior_weight/prior_scale
                  the light Reflex prior in the safe-exit stopping test
                  ONLY (pseudo-worlds / points per unit Q). It never
                  touches the override bar — R1 taught that lesson.
    k_floor_early/k_floor_late/early_tricks
                  the selection floors: MortalRook's exact k_sel (24 at
                  tricks < early_tricks, 48 after). A challenger is only
                  crowned on a full floor's evidence; only the reflex
                  incumbent can win before the floor (safe early exit,
                  from k_check_min worlds).
    k_max         adaptive ceiling past the floor on close calls.
    world_nodes   per-world solver node budget (deterministic timeout);
                  0 = unlimited. 32M ~ p90 of opening-lead worlds.
    """

    def __init__(self, net, belief, budget_scale: float = 1.0,
                 z_stop: float = 2.5, tau: float = 2.0,
                 prior_weight: float = 2.0, prior_scale: float = 120.0,
                 k_floor_early: int = 24, k_floor_late: int = 48,
                 early_tricks: int = 2, k_check_min: int = 12,
                 k_max: int = 384, eval_worlds: int = 24,
                 eval_min: int = 12,
                 world_nodes: int = 32_000_000, seed: int = 0,
                 contam_p: float = 0.0):
        self.net = net
        self.belief = belief
        # ORACLE CONTAMINATION (instrument only, never ships): with
        # probability contam_p a "sampled" world is the TRUE deal. The
        # dose-response curve p in {0,.25,.5,1} is the belief program's
        # kill switch — flat curve means better imagination can't help
        # this searcher. One-sided evidence by design (injecting truth is
        # not the same move as redistributing mass among plausible
        # worlds), so it can kill the program but never promote a net.
        self.contam_p = contam_p
        self.budget_scale = budget_scale
        self.z_stop = z_stop
        self.tau = tau
        self.prior_weight = prior_weight
        self.prior_scale = prior_scale
        self.k_floor_early = k_floor_early
        self.k_floor_late = k_floor_late
        self.early_tricks = early_tricks
        self.k_check_min = k_check_min
        self.k_max = k_max
        self.eval_worlds = eval_worlds
        self.eval_min = eval_min
        self.world_nodes = world_nodes
        self.seed = seed
        self.last_search = None
        self.last_think = None
        self.last_confirm = None   # confirm-round arithmetic (telemetry)
        # telemetry: {trick: [decisions, overrides, worlds, timeouts, secs]}
        self.stats: dict = {}

    # --- Reflex: shortlist + prior ------------------------------------

    def _reflex_q(self, env, seat, dtype, cands):
        import numpy as np
        import torch
        from .encoder import encode_state_for, encode_action
        s = encode_state_for(self.net, observe(env.g, seat), env.picks,
                             dtype, env.g, env.trump_intent)
        with torch.no_grad():
            S_ = torch.from_numpy(np.stack([s] * len(cands)))
            A_ = torch.from_numpy(
                np.stack([encode_action(dtype, a) for a in cands]))
            q = self.net(S_, A_).numpy()
        return s, {c: float(q[i]) for i, c in enumerate(cands)}

    def _budget(self, trick: int, is_lead: bool) -> float:
        b = BUDGET_MAP.get((trick, is_lead), LATE_BUDGET)
        return b * self.budget_scale

    # --- the deal-solve-check loop ------------------------------------

    def _world_values(self, o, g0, cands, rng, probs, bid_team, bid,
                      my_team):
        """One shared world: {cand: family value} or None (sampling
        failed / node budget spent — the whole world is discarded)."""
        try:
            if self.contam_p and rng.random() < self.contam_p:
                hands = [list(h) for h in g0.hands]
                gd = list(g0.go_down)
            elif probs is not None:
                hands, gd = sample_world_weighted(o, rng, probs)
            else:
                hands, gd = sample_world(o, rng)
        except Exception:
            return None
        g = materialize(o, hands, gd, g0.win_score, g0.lose_score)
        kw = dict(t0_tricks=g.tricks_won[0],
                  tricks_done=len(g.completed_tricks),
                  trick=tuple(g.trick_plays))
        hh = [list(h) for h in g.hands]
        try:
            vals = S.play_values(hh, g.trump, g.trick_leader,
                                 g.go_down_points(), only=list(cands),
                                 node_budget=self.world_nodes, **kw)
            for c in cands:
                if c not in vals:
                    # collapsed twin of a representative in THIS world's
                    # remaining-card set; only=[c] always prices it
                    vals[c] = S.play_values(
                        hh, g.trump, g.trick_leader, g.go_down_points(),
                        only=[c], node_budget=self.world_nodes, **kw)[c]
        except _SolveAbort:
            return None
        return {c: hand_value(g.points_taken[0] + vals[c],
                              bid_team, bid, my_team) for c in cands}

    def _think(self, env, seat, cands, qmap, deadline,
               replay_k=None, replay_ke=None):
        """The two phases. Returns (pick, k, ke, timeouts, stop, means).

        SELECT: accumulate shared worlds until the top candidate
        statistically separates from the runner-up (a LIGHT Reflex prior
        joins the stopping test as prior_weight pseudo-worlds — enough to
        end lopsided decisions early, never enough to bury a challenger),
        the budget expires, or k_max lands.

        CONFIRM: a challenger (raw-mean winner != reflex incumbent) must
        beat the incumbent by tau on FRESH evaluation worlds — the
        split-sample law, unchanged from MortalRook. Confirm ignores the
        deadline (bounded by eval_worlds); honesty is not budgetable."""
        g0 = env.g
        self.last_confirm = None
        o = observe(g0, seat)
        probs = None
        if self.belief is not None:
            try:
                probs = self.belief.posterior(env, seat, o, D_PLAY, cands)
            except Exception:
                probs = None
        my_team = team_of(seat)
        bid_team = team_of(g0.bid_winner)
        bid = g0.high_bid
        rng = random.Random(decision_seed(self.seed, g0, seat))
        incumbent = max(cands, key=lambda c: qmap[c])
        prior = {c: self.prior_scale * (qmap[c] - qmap[incumbent])
                 for c in cands}
        w = self.prior_weight
        trick = len(g0.completed_tricks)
        # R3 (two failed smokes taught this): the selection FLOOR is
        # MortalRook's exact k_sel — 24 at tricks 0-1, 48 after. Noisy
        # smaller selections push junk challengers into the confirm pass
        # faster than tau can filter them (R2: 2.9 overrides/hand, -4.5
        # pts). "Anytime" buys only the two SAFE moves: an early exit
        # when the top card IS the reflex incumbent (playing reflex early
        # is Cosmo-safe), and extra depth past the floor on close calls.
        k_floor = (self.k_floor_early if trick < self.early_tricks
                   else self.k_floor_late)

        sel = {c: [] for c in cands}
        k = 0
        timeouts = 0
        stop = "kmax"
        attempts = 0
        k_target = replay_k if replay_k is not None else self.k_max
        # attempt bound stays at the LIVE value even on replay: timeouts
        # interleave deterministically, so replay must be allowed exactly
        # as many discards as live burned reaching the recorded k
        max_attempts = self.k_max * 2 + 16

        def blended(c):
            return (sum(sel[c]) + w * prior[c]) / (k + w)

        while k < k_target:
            if attempts >= max_attempts:
                stop = "attempts"
                break
            if replay_k is None and k >= self.k_check_min:
                order = sorted(cands, key=blended, reverse=True)
                top, second = order[0], order[1]
                d = [a - b for a, b in zip(sel[top], sel[second])]
                mean_d = sum(d) / k
                var_d = sum(x * x for x in d) / k - mean_d * mean_d
                se = math.sqrt(max(0.0, var_d) / k)
                gap = blended(top) - blended(second)
                separated = se == 0.0 or gap > self.z_stop * se
                if separated and top == incumbent:
                    stop = "obvious"          # the safe early exit
                    break
                if k >= k_floor and (separated or time.time() >= deadline):
                    stop = "floor" if separated else "budget"
                    break
            attempts += 1
            wv = self._world_values(o, g0, cands, rng, probs,
                                    bid_team, bid, my_team)
            if wv is None:
                timeouts += 1
                continue
            for c in cands:
                sel[c].append(wv[c])
            k += 1

        if not k:
            return incumbent, 0, 0, timeouts, "no-worlds", {}
        means = {c: sum(v) / k for c, v in sel.items()}
        # the exit is authoritative: a safe exit IS the incumbent's win
        # (the blended top was the incumbent — do not re-derive a
        # challenger from raw means on sub-floor evidence; that mismatch
        # was R3's first-launch bug, 48% challenge rate at k=12), and a
        # challenger is NEVER crowned below the selection floor.
        if stop == "obvious" or k < k_floor:
            return incumbent, k, 0, timeouts, stop, means
        challenger = max(cands, key=lambda c: means[c])
        if challenger == incumbent:
            return incumbent, k, 0, timeouts, stop, means

        # CONFIRM on fresh worlds — same rng stream continues, so the
        # (k, ke) pair fully determines the worlds on replay
        ke_target = replay_ke if replay_ke is not None else self.eval_worlds
        ev_c: list[float] = []
        ev_i: list[float] = []
        ke = 0
        ev_attempts = 0
        ev_bound = self.eval_worlds * 2 + 16     # live bound, also on replay
        while ke < ke_target and ev_attempts < ev_bound:
            ev_attempts += 1
            wv = self._world_values(o, g0, [challenger, incumbent], rng,
                                    probs, bid_team, bid, my_team)
            if wv is None:
                timeouts += 1
                continue
            ev_c.append(wv[challenger])
            ev_i.append(wv[incumbent])
            ke += 1
        ok = ke >= self.eval_min and (sum(ev_c) - sum(ev_i)) / ke >= self.tau
        # telemetry only (spot-check narration): the confirm arithmetic
        self.last_confirm = dict(
            challenger=int(challenger), incumbent=int(incumbent),
            ke=ke, ev_challenger=round(sum(ev_c) / ke, 2) if ke else None,
            ev_incumbent=round(sum(ev_i) / ke, 2) if ke else None,
            passed=bool(ok))
        return (challenger if ok else incumbent), k, ke, timeouts, stop, means

    def choose(self, env, seat, dtype, cands):
        self.last_search = None
        self.last_think = None
        if dtype != D_PLAY or len(cands) <= 1:
            return model_choose(self.net, "cpu", env, seat, dtype, cands)
        t_start = time.time()
        use = list(cands)
        root_state, qmap = self._reflex_q(env, seat, dtype, use)
        if len(use) > CAND_CAP:
            use = sorted(use, key=lambda c: qmap[c], reverse=True)[:CAND_CAP]
        trick = len(env.g.completed_tricks)
        is_lead = len(env.g.trick_plays) == 0
        deadline = t_start + self._budget(trick, is_lead)
        incumbent = max(use, key=lambda c: qmap[c])
        pick, k, ke, timeouts, stop, means = self._think(
            env, seat, use, qmap, deadline)
        secs = time.time() - t_start
        self.last_search = (root_state, dtype, list(use),
                            [float(means.get(c, qmap[c])) for c in use])
        self.last_think = dict(
            trick=trick, lead=int(is_lead), k=k, ke=ke, timeouts=timeouts,
            stop=stop, secs=round(secs, 3), pick=int(pick),
            incumbent=int(incumbent), overrode=int(pick != incumbent),
            seed=decision_seed(self.seed, env.g, seat))
        st = self.stats.setdefault(trick, [0, 0, 0, 0, 0.0])
        st[0] += 1
        st[1] += int(pick != incumbent)
        st[2] += k + ke
        st[3] += timeouts
        st[4] += secs
        _log_think(self.last_think)
        return pick

    def replay(self, env, seat, dtype, cands, k: int, ke: int = 0):
        """Re-derive the decision bit-exactly from the recorded world
        counts (last_think["k"], last_think["ke"]). No clock involved:
        same seeds, same worlds, same node-budget aborts, same verdict."""
        if dtype != D_PLAY or len(cands) <= 1:
            return model_choose(self.net, "cpu", env, seat, dtype, cands)
        use = list(cands)
        _, qmap = self._reflex_q(env, seat, dtype, use)
        if len(use) > CAND_CAP:
            use = sorted(use, key=lambda c: qmap[c], reverse=True)[:CAND_CAP]
        pick, *_ = self._think(env, seat, use, qmap,
                               deadline=float("inf"),
                               replay_k=k, replay_ke=ke)
        return pick
