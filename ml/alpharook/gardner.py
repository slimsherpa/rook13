"""GARDNER FLAVOR — the family-legible skin over the frozen RC1 core.

Born from the 2026-08-10 Family Scouting Report: the family's partner
conventions grade free-to-positive under deep search (boss-14 lead
+10.6/lead, trump return −1.0), and the blunder docket shows the
complaints are about legibility, not points — in 36% of them RC1 would
have played the flagged card itself. So the style layer plays the
family's codebook wherever the search cannot show it costs real points.

The rule, per style spot:

  PARTNER LEAD (my team bought, I'm not the buyer, I'm leading):
    convention card =
      1. my highest off-trump boss 14 (longest-suit tiebreak) — "Always
         lead 14s to your partner when they take the bid", else
      2. my trump — the 13 if I hold BOTH 13+14 of trump (Rob's signal:
         "show it early so I know"), otherwise my highest trump, else
      3. none (search plays freely).
    Play the convention unless the searcher's pick clears it by more
    than tau_style family points on the priced worlds.

  DEFENDER LEAD (opponents bought, I'm leading):
    "Never lead trump when the other team takes the bid." If the search
    pick is a trump lead and a priced non-trump alternative sits within
    tau_style, play the alternative instead.

Everything else — bids, trump call, burial, follows — is the inner
agent, untouched. The searcher stays the honesty layer: a convention is
only ever played when the priced gap is inside tau_style, so the skin
cannot cost more than tau_style on any single decision, and in the
measured corpus the conventions usually PRICE AHEAD anyway.

Duck-types the duel agent interface (.choose, .last_search).
"""

from __future__ import annotations

import time

from rook.cards import team_of, suit_of, num_of
from .encoder import D_PLAY

CAND_CAP = 6          # mirror of anytime.CAND_CAP — keep in sync


def partner_convention(hand, trump, cands):
    """v1: the family's partner-lead codebook as ONE card. Kept for the
    gated tau4 configuration; v2 uses legible_candidates instead."""
    cset = set(cands)
    bosses = [c for c in cset
              if num_of(c) == 14 and suit_of(c) != trump]
    if bosses:
        suit_len = {s: sum(1 for c in hand if suit_of(c) == s)
                    for s in range(4)}
        return max(bosses, key=lambda c: suit_len[suit_of(c)])
    trumps = [c for c in cset if suit_of(c) == trump]
    if trumps:
        nums = {num_of(c) for c in trumps}
        if 13 in nums and 14 in nums:
            return next(c for c in trumps if num_of(c) == 13)
        return max(trumps, key=num_of)
    return None


def legible_candidates(hand, trump, cands):
    """v2 (Riley's shape amendment, 2026-08-11) / v2.1 ORDERING
    (2026-08-13): the codebook nominates CANDIDATES in family-preference
    order — off-trump boss 14s first (longest suit first: "always lead
    14s to your partner"), then the 13-of-trump signal, then top of
    trump, then bottom of trump. The search judges them against the
    whole hand shape; the flavor guarantees they are PRICED, and v2.1
    plays the HIGHEST-PREFERENCE one within tau of the search pick."""
    cset = set(cands)
    out = []
    bosses = [c for c in cset if num_of(c) == 14 and suit_of(c) != trump]
    suit_len = {s: sum(1 for c in hand if suit_of(c) == s)
                for s in range(4)}
    out.extend(sorted(bosses, key=lambda c: -suit_len[suit_of(c)]))
    trumps = sorted((c for c in cset if suit_of(c) == trump), key=num_of)
    if trumps:
        nums = {num_of(c): c for c in trumps}
        if 13 in nums and 14 in nums:
            out.append(nums[13])
        if trumps[-1] not in out:
            out.append(trumps[-1])
        if trumps[0] not in out:
            out.append(trumps[0])
    return out


class GardnerAgent:
    """Style wrapper: family conventions inside a tau_style price gate."""

    def __init__(self, inner, tau_style: float = 4.0,
                 defender_rule: bool = True, mode: str = "card",
                 telemetry_path: str | None = None):
        self.inner = inner            # AnytimeRookAgent
        self.tau_style = tau_style
        self.defender_rule = defender_rule
        self.mode = mode              # "card" = v1 rule; "shape" = v2
        self.telemetry_path = telemetry_path
        self.last_search = None
        self.last_think = None
        # telemetry: spots seen / convention played / search overrode /
        # defender-trump-lead swaps (+v2: merit / tiebreak)
        self.style_stats = {"partner_spots": 0, "conv_played": 0,
                            "search_override": 0, "def_swaps": 0,
                            "merit": 0, "tiebreak": 0}

    def _log(self, row):
        if not self.telemetry_path:
            return
        import json as _json
        with open(self.telemetry_path, "a") as f:
            f.write(_json.dumps(row) + "\n")

    def __getattr__(self, name):
        return getattr(self.inner, name)

    # --- the priced decision, with a forced candidate ------------------

    def _priced_think(self, env, seat, cands, force=None):
        inner = self.inner
        root_state, qmap = inner._reflex_q(env, seat, D_PLAY, cands)
        use = list(cands)
        if len(use) > CAND_CAP:
            use = sorted(use, key=lambda c: qmap[c],
                         reverse=True)[:CAND_CAP]
            if force is not None and force not in use:
                use.append(force)
        g = env.g
        trick = len(g.completed_tricks)
        is_lead = len(g.trick_plays) == 0
        deadline = time.time() + inner._budget(trick, is_lead)
        pick, k, ke, tos, stop, means = inner._think(
            env, seat, use, qmap, deadline)
        self.last_search = (root_state, D_PLAY, list(use),
                            [float(means.get(c, qmap[c])) for c in use])
        self.last_think = dict(trick=trick, lead=int(is_lead), k=k, ke=ke,
                               timeouts=tos, stop=stop, pick=int(pick))
        return pick, means

    def choose(self, env, seat, dtype, cands):
        if dtype != D_PLAY or len(cands) <= 1:
            return self.inner.choose(env, seat, dtype, cands)
        g = env.g
        is_lead = len(g.trick_plays) == 0
        buyer = g.bid_winner
        if not is_lead or buyer is None or g.trump is None:
            return self._delegate(env, seat, dtype, cands)

        my_team_bought = team_of(seat) == team_of(buyer)
        if my_team_bought and seat != buyer:
            # PARTNER LEAD — the style spot the family cares most about
            if self.mode == "shape":
                return self._partner_lead_v2(env, seat, dtype, cands)
            conv = partner_convention(g.hands[seat], g.trump, cands)
            if conv is None:
                return self._delegate(env, seat, dtype, cands)
            self.style_stats["partner_spots"] += 1
            pick, means = self._priced_think(env, seat, cands, force=conv)
            if pick == conv:
                self.style_stats["conv_played"] += 1
                return conv
            gap = means.get(pick, 0.0) - means.get(conv, 0.0)
            if gap <= self.tau_style:
                self.style_stats["conv_played"] += 1
                return conv
            self.style_stats["search_override"] += 1
            return pick

        if not my_team_bought and self.defender_rule:
            # DEFENDER LEAD — never lead their trump unless it's clearly
            # right
            pick, means = self._priced_think(env, seat, cands)
            if suit_of(pick) != g.trump:
                return pick
            off = [c for c in means if suit_of(c) != g.trump]
            if not off:
                return pick
            alt = max(off, key=lambda c: means[c])
            if means[pick] - means[alt] <= self.tau_style:
                self.style_stats["def_swaps"] += 1
                self._log(dict(spot="defender_lead", seat=seat,
                               trick=len(g.completed_tricks), mech="swap",
                               pick=int(alt), searched=int(pick),
                               gap=round(means[pick] - means[alt], 2)))
                return alt
            return pick

        return self._delegate(env, seat, dtype, cands)

    def _partner_lead_v2(self, env, seat, dtype, cands):
        """v2: every legible candidate priced, merit chooses, tau_style
        breaks near-ties toward the best legible card."""
        g = env.g
        legible = legible_candidates(g.hands[seat], g.trump, cands)
        if not legible:
            return self._delegate(env, seat, dtype, cands)
        self.style_stats["partner_spots"] += 1
        pick, means = self._priced_think_multi(env, seat, cands, legible)
        row = dict(spot="partner_lead", seat=seat,
                   trick=len(g.completed_tricks),
                   legible=[int(c) for c in legible], pick=int(pick),
                   means={str(c): round(v, 2) for c, v in means.items()})
        # v2.1: play the HIGHEST-PREFERENCE legible card within tau of
        # the search pick (codebook order, boss-14 first). The pick
        # itself qualifies at gap 0, so merit picks stand unless a
        # higher-preference card is close enough.
        for c in legible:
            if c not in means:
                continue
            gap = means.get(pick, 0.0) - means[c]
            if gap <= self.tau_style:
                row["gap"] = round(gap, 2)
                if c == pick:
                    self.style_stats["merit"] += 1
                    row["mech"] = "merit"
                else:
                    self.style_stats["tiebreak"] += 1
                    row["mech"] = "tiebreak"
                self.style_stats["conv_played"] += 1
                row["played"] = int(c)
                self._log(row)
                return c
        self.style_stats["search_override"] += 1
        row["mech"] = "override"
        self._log(row)
        return pick

    def _priced_think_multi(self, env, seat, cands, force_list):
        """Like _priced_think but forces a LIST of candidates into the
        priced shortlist."""
        inner = self.inner
        root_state, qmap = inner._reflex_q(env, seat, D_PLAY, cands)
        use = list(cands)
        if len(use) > CAND_CAP:
            use = sorted(use, key=lambda c: qmap[c],
                         reverse=True)[:CAND_CAP]
            for c in force_list:
                if c not in use:
                    use.append(c)
        g = env.g
        trick = len(g.completed_tricks)
        is_lead = len(g.trick_plays) == 0
        deadline = time.time() + inner._budget(trick, is_lead)
        pick, k, ke, tos, stop, means = inner._think(
            env, seat, use, qmap, deadline)
        self.last_search = (root_state, D_PLAY, list(use),
                            [float(means.get(c, qmap[c])) for c in use])
        self.last_think = dict(trick=trick, lead=int(is_lead), k=k, ke=ke,
                               timeouts=tos, stop=stop, pick=int(pick))
        return pick, means

    def _delegate(self, env, seat, dtype, cands):
        pick = self.inner.choose(env, seat, dtype, cands)
        self.last_search = self.inner.last_search
        self.last_think = self.inner.last_think
        return pick
