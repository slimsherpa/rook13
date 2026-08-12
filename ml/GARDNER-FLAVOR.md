# GARDNER FLAVOR — the family-legible skin over frozen RC1

**Dated 2026-08-10 (evening), pre-registered before the gate runs.**
Origin: the Family Scouting Report (claude.ai/code/artifact/6d68bd0e-083d-466b-a4fc-1b60cb0cf0e6)
— the family's conventions grade free-to-positive, their complaints about
bot partners are 44% vindicated / 3% wrong, and a human+Cosmo partnership
wins less than human+gen16 (40-42% vs 51%): legibility IS team strength
when a human holds one of the seats.

## The design (alpharook/gardner.py)

`GardnerAgent` wraps the frozen RC1 anytime core. Card-play style spots
only; bids, trump call, burial, follows untouched:

- **Partner lead** (my team bought, I'm not the buyer): play the family
  convention — off-trump boss 14 (longest-suit tiebreak), else trump
  (the 13 as a signal when holding 13+14, else highest) — unless the
  searcher's pick clears the convention by > tau_style on the priced
  worlds. Convention card is always forced into the priced shortlist.
- **Defender lead**: never lead the opponents' trump when a priced
  non-trump alternative sits within tau_style.
- tau_style default **4.0 family points** (override bar tau is 2.0; the
  style bar is looser on purpose — legibility buys the team more than 2
  points of solo EV when the partner is human).

Measured priors from the scouting corpus: partner boss-14 +10.6/lead
(n=19), trump return −1.0 (n=32), so the expected EV cost is ≈0 and
possibly negative-cost. Smoke (5 hands, seed 123): 10 partner spots,
9 conventions played, 1 search override, 1 defender swap.

## The gate (pre-registered)

Paired duplicate-deck self-play duel, both sides the identical RC1 stack
(gen21-cand1 + gen15 belief @0.5, anytime 0.2), side A wearing
`--gardner-a 4.0`. Seeds: DEV pool block base 3.9e9 (out of the report
streams). Command: scripts/gardner_gate.sh (workers 5, pairs 800,
overnight on the MBP).

**Ship lines, written before results (family pts/hand, paired A−B):**

| Result | Verdict |
|---|---|
| Δ ≥ +0.5 | flavor is free-or-better — ship it and tell the family |
| −1.0 ≤ Δ < +0.5 | ship-eligible: the legibility is worth ≤1 pt/hand |
| −2.5 ≤ Δ < −1.0 | hold; retry at tau_style 2.0 before deciding |
| Δ < −2.5 | kill the current rule set; investigate which spot bleeds |

Numbers may be renegotiated only BEFORE the dump is read.

**VERDICT (2026-08-11, 800 pairs / 19,849 hands): Δ = −0.40 ± 0.50
pts/hand (95% CI [−1.38, +0.57]), game wins 49.9%, contracts identical
(64%/64%). → SHIP-ELIGIBLE per the −1.0 line.** Cost decomposition:
36.6% of hands style-affected; defender no-trump rule ≈ free
(−0.32/divergent hand); the whole cost sits in partner-lead spots
(−2.12/divergent hand). Refinement queue: (1) suit-level conventions —
search picks the rank inside the conventional suit; (2) per-convention
telemetry gate + per-spot tau; (3) Riley's merit-only ablation — full
pricing in partner spots, no style override, measures how much
convention the evidence recovers alone. Interim read at 471 pairs
(−0.57 ± 0.60) was reported to Riley before completion; thresholds
never moved. Self-play is
the harsh grader here — it prices pure EV between two bots and captures
NONE of the human-coordination upside the wrapper exists for; that
asymmetry is why the ship bar tolerates a small negative.

## v2 — "shape" mode (pre-registered 2026-08-11 before its gate runs)

Riley's amendment: the codebook nominates CANDIDATES (all off-trump
bosses, top of trump, bottom of trump, the 13-signal), never a card.
All are force-priced; the search judges them against the whole hand
shape; tau_style (4.0) only breaks near-ties toward the best legible
card. Telemetry per spot: mech = merit / tiebreak / override.
Duel flag: --gardner-a -4.0 (negative = shape mode).
Smoke (4 hands): 8 partner spots = 4 merit + 4 tiebreak + 0 override.

**v2 gate ship lines (same as v1, written before reading):** paired
Δ vs vanilla ≥ +0.5 free-or-better · ≥ −1.0 ship-eligible · < −2.5
kill. Additional pre-registered expectation: v2 should cost LESS than
v1's −0.40 in the partner-lead decomposition; if v2's partner-lead
divergent-hand cost is not better than v1's −2.12, prefer v1 for ship
regardless of headline delta (the mechanism, not just the total, must
improve).

**V2 VERDICT (2026-08-12, 700 pairs / 17,512 hands): Δ = −0.15 ± 0.43
(CI [−1.00, +0.70]), game wins 49.2%. Mechanism bar PASSED —
partner-lead cost −1.68 vs v1's −2.12; defender −0.58. Telemetry
(8,513 partner spots): merit 67% / tiebreak 16% (mean 3.2 pts) /
override 17%. Deal-matched v1 vs v2 on 603 common deals: +0.16 vs
−0.17 (noise). → v2 SHIPS to the receipt duel** (launched 2026-08-12,
FLAVOR=v2, 700 pairs, seeds 5.9e9).

## The receipt duel (pre-registered 2026-08-12, scripts/receipt_duel.sh)

Winner of the v2 gate (per its pre-registered rules, auto-picked by
scripts/v2_rollup.py) vs the EXACT production teacher — replicated
flag-for-flag from service/brain/main.py: gen21-cand1 reflex +
SearchAgent worlds=24 prior 2.0 min_trick 0 play-only, belief gen15
@0.5 (models/gen15.pt == runs/gen15/best_duel.pt, md5 23ef1a8b). Side A
at the serving clock (anytime 0.25). GATE-pool seeds 5.9e9.
**Ship line: paired delta >= 0 within CI at the serving clock; a
clearly negative receipt blocks the launch.** Banked lab-budget
baseline: +0.8 pts/hand ~ 51.2% (1,200 games).

Production path discovered 2026-08-12: the anytime searcher is ALREADY
ported into service/brain/main.py behind ANYTIME_ENABLED (dark, P1.4
plumbing) with ANYTIME_SCALE env. Launch = Gardner layer into the
service, flip the flag, point the partner-seat style. Latency truth:
opening lead is K-floor-bound (~9-10s median on the MBP at any budget
dial; everything else instant) — accept / parallelize world-solves /
bigger box; never lower the floor. Feel test: lineserve now honors
GARDNER_MODE=shape|card + GARDNER_TAU.

## Queued next (not tonight — the gate owns the cores)

1. **Full-corpus deep grading** (~45k decisions, all 624 trio games,
   resumable): `~/torch-env/bin/python scripts/prod_grade.py --players
   "Nate Girsberger,Tyler Girsberger,Carson Gardner" --workers 8
   --src runs/prodgames/games_trio.jsonl --widow-budget 8
   --budget-scale 0.25 --out runs/prodgames/grades.jsonl`
   (games_trio.jsonl = all trio games; sample file covered 105 already —
   same out file, done-pairs skip.)
2. Per-player style parameters (lead prefs, laydown eagerness, bid
   curve) fitted from the full corpus → persona flavors (NateBot etc.).
3. Family report cards (parked by Riley — "one day, not now").
