# R2 `defense_ladder` — why don't we set people?

**Ran 2026-08-09 (boxes 1/2/4). Verdict: the recoverable defense gap is
~80% imagination-shaped. Bucket D (finite-sample/discipline) is small.
Third independent instrument to converge on the same wall.**

Method: counterfactual hand replays from the belief soak. For each sampled
hand, the recorded auction/widow/trump replay exactly; from the first card,
the DEFENDING team is upgraded while the declaring team plays the live
anytime core at production budgets. Metric = actual set-rates, not proxies.
Rung A (candidate menu) was priced separately by R1: dead (0.3 pts/hand).

| Defense rung | hands | set-rate | of live-MADE contracts, flipped to sets |
|---|---|---|---|
| live (as recorded) | — | 34.3% | — |
| high-K (same bel15 worlds, k=96 forced + confirm) | 373 | 35.9% | **7.7%** |
| god (exact true-deal play) | 1,665 | 44.4% | **21.0%** |

Reading: unlimited patience with today's imagination recovers ~1/5 of the
ceiling; perfect knowledge recovers all of it. The B+C+E complex
(world-model + valuation + residue) holds ~4/5 of the recoverable gap —
inseparable further until a better belief net exists to slot into the
ladder (belief25-J rung deferred with the Phase-2 pivot).

Convergent evidence stack this week: contamination dose-response (+30
pts/hand at p≥0.5, saturating), R2 ladder (above), Riley's human eval of
36 opening leads (his gut sided with the raw search evidence against the
played habit; graded partner-contract leads 4.6/7 vs declarer leads
6.4/7). All three point at imagination quality, concentrated early in the
hand.

Human-eval side findings (banked in `reports/leadcards_grades.json`):
every hand Riley graded Bad was god-strictly-bad; the confidence gate
(τ) loses close arguments on opening leads where imagination is blurriest;
partner-contract leads carry an architectural signaling gap (determinized
search cannot value information transfer) — family-convention lead rules
proposed as the cheap countermeasure.

## Companion verdict: BidBot-v1 live gate (importance-sampled marginal)

150 divergent pairs (v1 vs v0 disagree-deals only, ~13% divergence rate):
**v1 win 49.3%, −0.25 ± 2.70 pts/hand — a wash. v1 does not ship; v0
keeps its chair.** Calibration gains on flashcards did not translate to
table wins. Interpretation strengthened by the seat-position analysis:
twin labels encode the current bot's own lead weakness (raising when
partner will lead measures WORST — an artifact of bad bot leads, not
Rook), so the bidding textbook is meta-poisoned and gets re-milled after
CardPlayer improves. Riley's ordering (widow → per-seat CardPlayer →
BidBot last) adopted 2026-08-09 evening; fleet workloads wound down in
favor of the Laboratory program (human go-down + first-two-trick picks vs
RC1, replay-scored).

Files: `runs/r2/r2_{god,highk}_box*_w*.jsonl`, `runs/bidmarg/*.jsonl`.
