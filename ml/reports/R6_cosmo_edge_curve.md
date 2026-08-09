# R6 `cosmo_edge_curve` — what does 60% cost, empirically?

**Ran 2026-08-08 night (Phase 1, first report to land). Verdict: `maybe` —
context instrument, works as designed; never a gate (pre-registered).**

Question: the pts/hand ↔ game-win% relationship against Cosmo. Method: mined
every banked battery where side B is production Cosmo (gen21 reflex ×
gen15-belief × t0, K24, min-trick 0); pooled hands per battery; least-squares
of game-win% on paired pts/hand. Sign convention verified against
`scripts/alpharook_dash.py` (hh[i][3] = A−B per hand).

## Cosmo-only batteries (B = Cosmo-as-production)

| Battery | n games | n hands | pts/hand (A) | game-win% (A) |
|---|---|---|---|---|
| P1.2 house battery (AnytimeRook) | 1,996 | 25,340 | +2.45 | 53.8 |
| MortalRook K384 | 238 | 2,903 | +2.16 | 53.8 |
| MortalRook K96 | 2,360 | 29,295 | +2.07 | 51.9 |
| MortalRook K192 | 1,166 | 13,937 | +1.78 | 52.7 |
| P3 autopsy control (bare anytime) | 800 | 9,728 | +1.55 | 51.5 |
| MortalRook K48 | 3,000 | 36,613 | +1.36 | 51.8 |
| P3 crown (assembled + MortalWidow) | 1,896 | 23,050 | +0.72 | 50.3 |
| Arm C — solver-tail(4) on Cosmo core | 1,400 | 17,339 | +0.42 | 50.7 |
| P2 gate crown (assembled + BidBot) | 1,200 | 14,599 | +0.37 | 51.2 |
| MortalRook K768 (small n) | 72 | 856 | −1.59 | 51.4 |
| Arm A — gen23 flywheel | 1,200 | 15,172 | −5.33 | 43.3 |

Excluded from the Cosmo-only fit: the cougar gauntlet rung (+6.33 → 58.8%,
80 games) — cougar is the gen13 browser rung, a different opponent; the
plan's law says cross-opponent mapping is confounded. (Kept in the appendix
fit below; it happens to sit ON the line, which is weak corroboration that
the slope survives to +6.)

## The slope

- All 12 batteries incl. cougar: **1.22 pp per pt/hand**, intercept 50.5%.
- Dropping small-n outliers (cougar, K768): **1.29 pp per pt/hand**,
  intercept 50.1%.
- Data span for the Cosmo-only set: −5.3 … +2.5 pts/hand — the negative tail
  (Arm A, 43.3%) anchors the low side well; extrapolation above +2.5 leans
  on the (excluded, on-line) cougar point.

## The answer to the week's question

**60% game-win ≈ +7.7 to +8.3 pts/hand** at the fitted slope — the
optimistic end of the plan's assumed +8–13. RC1 today: +0.8 → ~51%.
The gap to 60% is ~7 pts/hand of buildable edge. Context only, never a gate.

Totals: 15,408 games, 189,788 hands across 12 batteries. Cross-checked
against the K-ladder table in `history/alpharook-era/README.md`, the Arm A/C
verdicts in `GEN24-PLAN.md`, and the banked crown numbers. Full
exclusion list (marginal arms, god arms, twin-gate formats, pre-Cosmo
gauntlets) in the mining agent's log, session 2026-08-08.
