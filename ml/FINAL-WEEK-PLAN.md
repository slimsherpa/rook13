# FINAL-WEEK-PLAN — the diagnostic sprint and the last push

**Dated 2026-08-08 (evening). Window: ~2026-08-09 → 2026-08-15.**
Converged over three rounds of external review (Claude ↔ second LLM, Riley
arbitrating). Strategy memos: Campaign Memo № 3 ("The Gap Map",
claude.ai/code/artifact/9e7742a3-6841-4624-a2c0-e85a5b91afea), Field Report № 2
("The Overnight Verdict"). This file is the operating document; the memos are
the argument.

**The one-sentence strategy:** stop debating, start diagnosing — spend Days 1–2
making AlphaRook explain *why it still loses to Cosmo*, wall by wall, then
build at most two fixes the evidence demands, freeze, and grade the result on
sealed deals nobody has touched.

**The motto:** MEASURE THE BEST LEGAL MORTAL BEFORE COMPARING TO GOD.

---

## 1. Why this plan (the diagnosis)

- Gen25-RC1 beats production Cosmo by **+0.8 pts/hand ≈ 51.2%** game-win
  (1,200 games). CardPlayer's +2.04 ± 1.01 is the only banked large edge.
- The god gap is **−38.3 ± 8.2 pts/hand**, and it is **contract-shaped, not
  trick-shaped**: god makes 83% of contracts vs our 53%, sets opponents 47%
  vs our 17%, while our own play loss collapses to ~0.25 pts/decision by
  trick 7 (endgame ≈ solved). 35.4% of contracts we buy are unmakeable at par.
- Per our own Cosmo history, the win-rate slope near parity is roughly
  1–1.5 pp per pt/hand → **60% game-win costs on the order of +8–13 pts/hand**.
  That is not provable-by-sampling; it is buildable-or-not.
- We hold ~8 attractive improvement ideas and 7 days. Picking by conviction
  has a measured failure history (WidowBrain, BidBrain, five bid attackers).
  So the week opens with instruments, not bets.

## 2. Goals, success tiers, non-goals

**Primary goal:** a defensible causal decomposition of the RC1↔Cosmo and
RC1↔god gaps — which wall (menu / worlds / valuation / discipline / oracle
residue) holds how many points.

**Secondary goal:** ship at most two evidence-selected improvements into
Gen25-RC2 and grade it honestly on virgin seeds.

**Success tiers (pre-registered, virgin battery, paired pts/hand vs Cosmo):**
- `< +2` — RC1 improved; report honestly; the map is the prize.
- `+3–5` — genuine mid-50s bot; worth a full crown battery.
- `≥ +6` — stop everything; all boxes on Cosmo; possible 60% neighborhood.

**Non-goals this week:** proving 51% at scale (buying crown sample), ReBeL /
CFR / ISMCTS rewrites, new reflex nets, role-specialist nets, shipping to
production, UX/speed work.

## 3. The laws of the week

1. **Legal-mortal referee first.** Every regret/failure measurement is graded
   against the *best legal mortal* (same bel15 worlds, same solver, same
   utility, unrestricted candidates) before god. God's number is an upper
   bound on treasure that exists; the legal number is treasure reachable.
2. **Measurement-side winner's curse guard.** Any "best legal mortal"
   reference runs at high K with the same select/confirm discipline — a raw
   argmax over few worlds would manufacture phantom regret.
3. **Three seed pools** (§4). Virgin pool untouched until RC2 freeze.
4. **Thresholds before results.** Every report's kill / backlog / build lines
   are written in this file (§6) before the report runs. Numbers may be
   renegotiated only *before* a report is read, never after.
5. **Oracle instruments never train shipping nets.** Truth-conditioned
   anything (contamination curve, one-card reveal, cheat belief) is
   instrumentation only. Standing law, restated.
6. **VOI is evaluation-only this week.** No VOI-weighted training loss until
   predicted-VOI vs realized-reveal-value calibration is demonstrated
   (feedback-loop hazard: VOI derives from the current imperfect stack).
7. **Time-boxed instrumentation.** Each report defines its minimum viable
   answer first; if the window closes, it ships the partial answer. Verdict
   vocabulary: `dead` / `maybe` / `big vein`.
8. **Selection stops at end of Day 5.** No candidate changes after, no
   matter what. Freeze ritual §9.
9. **No mid-battery tinkering.** Once virgin seeds release, nothing changes —
   a bad first 300 games is weather.
10. **≤ 2 build paths in Phase 2**, gated A alone / B alone / A+B (gains may
    not be additive — shared upstream organs).
11. Standing laws remain: no omniscient inputs in training streams, hindsight
    in labels never inputs, gate under the stack it will live in, crown
    nothing under 1,000 pairs (final battery), per-hand currency first,
    replication before belief.

## 4. Seed pools

| Pool | Purpose | Rules |
|---|---|---|
| `DEV` | building + iterating reports and candidates | unlimited reuse |
| `GATE` | choosing among candidate components (Phase 2 paired gates) | limited reuse; never for headline claims |
| `VIRGIN` | the Day 6–7 crown battery | generated in Phase 0, ranges recorded here, **nobody looks until freeze** |

**Generated 2026-08-08 22:20 MT (Phase 0 execution).** Six candidate blocks
at `i × 2e9 + 1e9`; a real die (secrets.randbelow) rolled **4** for VIRGIN.

| Pool | seed base | notes |
|---|---|---|
| `DEV` | **3,000,000,000** | unlimited reuse |
| `GATE` | **5,000,000,000** | limited reuse, candidate selection only |
| `VIRGIN` | **9,000,000,000** | SEALED — no games on this block until RC2 freeze |
| spares | 7e9 · 11e9 · 13e9 | unassigned |

Per-box offsets within a pool: `base + box_index × 10,000,000`.

## 5. Phase 0 — lockdown checklist (before any report)

- [x] **τ pinned to 0.05** (2026-08-08 22:15 MT): `p2_gate_keeper.sh` default
      was 0.08, now 0.05. All other scripts already 0.05.
- [x] **Game-end audit (2026-08-08 22:15 MT) — divergence found and fixed.**
      Production (`src/lib/game/engine.ts:618`) wins on **strictly > 500**
      (house rule 2026-08-03); the ML engine (`rook/engine.py:281`) wins on
      `>= win_score` and everything defaulted to 500. Since scores are
      multiples of 5, `win_score=505` with `>=` reproduces production
      exactly — defaults changed to **505** in `env.py`, `duel.py` (incl.
      argparse), `winprob.py`. The `-win_score//2` lose derivation in duel.py
      is now pinned at **−250** (505//2 would have drifted it to −253).
      Retired gen24-era tools (bidcity, bidoracle, bidgrad, bidpairs,
      bidbrain_data) left at 500 — they don't run this week.
      **Caveat recorded:** every banked corpus through tonight's belief soak
      (incl. `winprob25.json` labels and bidbot-v0's wp features) was
      generated under win-at-≥500. Per-hand paired measurements are
      unaffected; game-win% comparisons old-vs-new carry a ~few-per-mille
      rule difference. winprob refresh should re-fit on 505-rule states.
- [x] **Seed pools generated + recorded** (§4). VIRGIN = 9e9, by die roll 4.
- [x] **RC1 provenance frozen** (§5b below).
- [x] Background workloads: twin soak re-armed at 505/τ0.05 (§13);
      belief25-J training pending corpus mill.
- [x] Belief soak corpus synced to MBP — 2,826 games local (§11, §13).

## 5b. Gen25-RC1 provenance (frozen 2026-08-08 22:20 MT)

- git commit `98d2aef` (P1 complete) + uncommitted final-week additions
  (bidbot/belief25/report tooling; committed as the week proceeds).
- SHA-256:
  - `gen21-cand1.pt` `abd575ab1e32641c58f1792d138cc273dd5a40dad3c0fcb46e5ef7243477cfa0`
  - `gen15.pt` `ba8ad5c60a95519ada32f56ef3802f5175fc476b799f3806138e3eb4ec467272`
  - `widowprop-v0.pt` `2871b165af3e3fbf7837e5f5b1f66bc3606e8cbfb2eae91ef65754df03319a48`
  - `bidbot-v0.pt` `1a9caaf963a71d57800d7cb92eba4dd26d581274c598f27dc16599910fc22cb8`
  - `winprob25.json` `f1fff8e8203f4b0a8c1729fc181d7bcace945e073eb7dd52793ec5936732e657`
- RC1 per-side flag set (as run in the belief soak, per live process):
  `--a models/gen21-cand1.pt --script-a none --anytime-a 1.0 --mwidow-a 60
  --proposer-a models/widowprop-v0.pt --bidbot-a models/bidbot-v0.pt
  --bidbot-tau-a 0.05 --belief-a models/gen15.pt --belief-temp-a 0.5`
  (soak predates the 505 fix; future RC1 runs add `--win-score 505` via the
  new default).

## 6. Phase 1 — the six reports (Days 1–2)

Ordered by upside-per-engineering-hour. Each: question → method → MVA →
threshold → deliverable. All run offline on banked dumps + the fresh soak
corpus unless noted. Time-box: ~half a day of engineering each, hard.

### R1 `shortlist_regret` — is the menu too small?
- **Question:** at tricks 0–2, how often would the *best legal mortal*
  (same worlds/solver/utility, ALL legal candidates, high-K + discipline)
  choose outside Reflex's top-6 shortlist, and at what cost?
- **Also compute** the god-referee version as the oracle upper bound —
  reported separately, never conflated.
- **MVA:** exclusion rate + mean regret when excluded + est. pts/hand,
  split declarer/defender, tricks 0/1/2.
- **Thresholds:** `< 0.5 pts/hand` → dead forever. `0.5–1.5` → backlog.
  `> 1.5` → Phase-2 candidate: adaptive top-8/all on early high-uncertainty
  decisions, same node budget.
- **Deliverable:** table + one bar chart (regret by trick × role).

### R2 `defense_ladder` — why don't we set people? (the big one)
- **Question:** decompose the 17%-vs-47% set-rate gap on opponent contracts.
- **Method — the intelligence ladder.** For a bank of missed-set hands, price
  each wall by upgrading one faculty at a time:
  `RC1 actual` → `+ all legal candidates` → `+ effectively-infinite samples
  under current belief (high-K replay, decision subsample)` → `+ better belief
  (belief25-J when available; else skip rung)` → `+ one revealed fact
  (top-VOI card)` → `AlphaGodRook`.
  Buckets per failure: **A** candidate exclusion, **B** world-model
  disagreement, **C** valuation disagreement (P(set)/game-WP would find it),
  **D** finite-sample discipline failure, **E** oracle-only residue
  (unexplained remainder — reported as residual with that caveat, never as
  "proven impossible").
- **MVA:** bucket shares + pts/hand attached to each rung of the ladder.
- **Threshold:** any single bucket ≥ 40% of recoverable gap → that bucket's
  fix becomes a Phase-2 priority.
- **Deliverable:** the ladder waterfall chart + failure-tree (Sankey-style)
  breakdown. Likely the most informative artifact of the month.

### R3 `sampler_autopsy` — is the imagination-builder the weak link?
- **Question:** separate belief quality (marginals) from world-construction
  quality (joints). A good net + bad determinizer still makes garbage worlds.
- **Method:** on soak-corpus decisions with known true deals: uniform-fallback
  rate; counter placement; void consistency; **suit-length error and
  hidden-hand NLL of sampled worlds vs true deals**; all conditioned on
  auction strength and trick number. Compare `sample_world_weighted` against
  a constrained/MCMC-style re-sampler on the *same bel15 marginals* if time
  permits (the "extract more from bel15" arm).
- **MVA:** the marginal-vs-joint gap table.
- **Thresholds:** offline coherence better but zero decision changes → no
  fleet test. Joint incoherence material AND high-K decision flips under
  better construction → Phase-2 candidate (fix construction before/with new net).
- **Deliverable:** coherence table + flip-rate-under-resampling number.

### R4 `utility_map` — where does hand-points ≠ game-win?
- **Question:** where would cp1/wm1 decide differently if solver values were
  priced through winprob25 instead of family points — and how much game-WP is
  attached? Flip *leverage*, not flip rate.
- **Method:** offline replay of banked decisions; re-price recorded
  solved-world tables through winprob25; per decision record both choices,
  ΔWP between them, state (seat, role, trick, score margin, distance to 505 /
  −250, contract size, widow-vs-play).
- **MVA:** the situation matrix (flip% × mean ΔWP × frequency → est.
  leverage) for: declarer, defender, opening lead, late tricks, near-cliff,
  near-505, contract ≥100 (ours/theirs), widow selection.
- **Thresholds:** total leverage `< 0.5 pts/hand-equiv` → dead. Rare flips
  with large leverage concentrated in specific states → ideal surgical
  candidate: **localized WP utility** in exactly those states (with τ/z
  re-calibration in the touched states — the discipline's constants are
  points-denominated; changing currency silently invalidates them).
  Widespread small flips → dead (that's noise + sigmoid compression).
- **Deliverable:** the matrix as a heatmap + top-20 flip examples for eyeballs.

### R5 `voi_probe` — does AlphaRook know what it doesn't know? (Riley's G14)
- **Question:** (a) is one-card information materially valuable? (b) can the
  stack identify *which* card matters?
- **Method:** VOI(c) from existing machinery — partition the searcher's
  sampled worlds by holder of card c; divergence of best action/value across
  partitions = decision-criticality. Offline on banked decisions: compare
  **predicted VOI** vs **realized reveal value** (condition worlds on the true
  holder of the chosen card, re-search, measure swing) vs **oracle-best card**
  (retrospectively most valuable single reveal).
- **MVA:** three numbers — mean realized value of oracle-best single reveal;
  VOI-selected reveal; random reveal — plus the predicted-vs-realized
  calibration scatter.
- **Thresholds:** oracle-best reveal `< 1 pt/hand` → shelve (science, not
  this week). `1–3` → adopt as belief diagnostic (decision-critical placement
  accuracy joins the belief25-J gauge alongside counters + boss cards).
  `> 3` → major: targeted information quality becomes a Phase-2 input, and
  the AlphaQueryRook benchmark (none/random/boss/VOI/oracle reveal arms)
  gets built.
- **Deliverable:** calibration scatter + reveal-value bars by card type
  (boss / counter / trump-length-relevant / other).

### R6 `cosmo_edge_curve` — what does 60% cost, empirically?
- **Question:** the pts/hand ↔ game-win% relationship **against Cosmo only**
  (cross-opponent mapping is confounded).
- **Method:** mine every banked Cosmo battery: config, n games, paired
  pts/hand, game-win%. Fit the local slope with honest CIs.
- **MVA:** the scatter + slope. **Context only, never a gate** — the data
  spans just +0.1..+2.2 pts/hand; extrapolation to +8 is decoration.
- **Deliverable:** one scatter chart with fit + CI band.

### Optional instrument R7 `god_full` — the true luck floor (added 2026-08-08 after Riley's question)
AlphaGodRook as shipped is a **card-play-only** god: bids and widow stay with
the gen21 reflex (god.py docstring, by design — apples-to-apples play
ceiling). Autopsy of its 6 losses in 60 gauntlet games shows they are
**contract-shaped**: it got set on reflex-bought unmakeable contracts (4 of 8
bought in one lost game) and could not stop RC1's par-makeable contracts —
i.e. god's own losses replicate the campaign thesis. Proposed instrument:
**AlphaGodRook-FULL** — par bidding + par widow (omniscient contract
selection: for each trump, par value with optimal burial, widow known; bid up
to par, pass below floor). Its loss rate vs RC1 ≈ the TRUE luck floor of Rook
(deal sequences unwinnable by any skill). Prediction: 1–3%. Half-day build on
ceiling.py's par machinery; one box-evening to run. Also directly prices the
auction+widow share of the god gap (god_full − god_play_only). Not required
for Phase 2; build if a box is free or the family wants the number.

### Kill-switch instrument (1–2 boxes, parallel): `oracle_contamination`
Worlds sampled as mixture: probability p the true deal, 1−p from bel15;
p ∈ {0, .25, .5, 1}. **Named precisely:** oracle-*contamination* response —
NOT a belief-quality curve (injecting truth ≠ redistributing mass among
plausible worlds; p=1 ≠ AlphaGodRook since bb sits outside the belief).
**Use:** flat curve → devastating for belief work, kill it. Any other shape →
belief25-J still must earn promotion on its own legal metrics. One-sided.

## 7. Phase 2 — build (Days 3–5)

- Reports select **≤ 2** paths (Law 10). Candidate menu the reports choose
  from: adaptive shortlist · belief25-J promotion · world-construction fix ·
  localized WP / defensive P(set) utility · BidBot-v1 (10× corpus) ·
  role-aware clock. Nothing else.
- Gates: GATE seeds, duplicate decks, paired per-hand currency, large-effect
  screening (a few hundred pairs — we hunt points, not tenths), fixed node
  budgets (CPX is shared-CPU; wall-clock lies across boxes).
- Test **A alone, B alone, A+B** — interaction explicit.
- BidBot-v1 (mill week's twin corpus, retrain, τ-swept calibration, override
  review ritual) proceeds as background regardless, gated on the
  importance-sampled marginal instrument (play out only divergent decks,
  reweight — the old instrument was 92% card-locked noise).
- Selection halts end of Day 5. Unconditionally.

## 8. Branch map — what surprises change

| If the reports say… | Then… |
|---|---|
| Shortlist regret > 1.5 pts/hand | adaptive early shortlist is a Phase-2 path (cheapest possible win — no new net) |
| Defense tree dominated by **B** (world-model) | belief25-J + sampler take both Phase-2 slots; strongest possible evidence for the belief program |
| Defense tree dominated by **C** (valuation) | build the defensive utility specialist (P(set)/localized WP), not wholesale WP |
| Defense tree dominated by **D** (discipline/budget) | role-aware clock + budget re-shaping; belief work deprioritized |
| Sampler joint-incoherent but bel15 marginals fine | fix world construction FIRST; do not train another net; possibly the cheapest large win |
| Oracle-contamination curve flat | belief program dead this week; fleet pivots to auction + whatever R1/R4 lit up |
| utility_map lights up only widow + near-cliff | localized WP exactly there, with local τ re-calibration; leave card play in points |
| VOI oracle-best reveal > 3 pts/hand | decision-critical info is the story; belief gauge reweights; AlphaQueryRook gets built |
| belief25-J loses to bel15 on legal metrics | no fleet duel, period; unfrozen/architecture arms continue on MBP only |
| Nothing opens a > 2 pt vein | honest stop: ship the map, the ladder chart, and RC1+small wins; the campaign ends with a measured ceiling, not a mystery |

**Rigid:** the laws (§3), seed pools, freeze date, thresholds-before-results,
≤2 builds, virgin battery protocol.
**Flexible:** which builds, fleet allocation, report depth beyond MVA, day
boundaries (a report finishing early releases its box), even skipping a
report whose question a prior report already answered.

## 9. Phase 3 — the freeze ritual (end of Day 5)

Record ALL of: git commit hash · SHA-256 of every model file in the RC2
config · full duel command line · τ · budget map/scale · node caps · seed
pool ids. Then: no code, no weights, no config changes. Only then release
VIRGIN seeds.

## 10. Phase 4 — the virgin battery (Days 6–7)

Five boxes, RC2 vs production-config Cosmo, virgin seeds, duplicate decks,
family format, ≥ 1,000 pairs. Per-hand currency first, game-win% beside it.
Success tiers per §2. No mid-battery changes (Law 9). Then Field Report № 4.

## 11. Metrics, KPIs, and charts

**Standing per-duel panel** (every fleet run, via `p2gate_report.py` + think
logs — these are the week's KPIs):
- paired pts/hand ± 95% CI (primary), game-win%, sweeps
- make% A vs B, avg bid, bid distribution by score-margin bucket
- cards-decided% / skill-hands split (the luck decomposition)
- cp: challenge rate, overrides/hand, K distribution, stop reasons,
  timeout rate, median/p90 think by trick (floors binding = min K ≥ 24/48)
- wm: K, stop reason, override+confirm rates, s/contract
- bb: override rate, mean claimed Δu, τ in force
- ops: s/game, games/hr/box, $ per 1k hands, worker count, corpus rows banked
- corpus law: replay-audit pass rate (any drop from 100% halts the run)

**Chart catalog for the week** (each report names its own above; the set):
1. The intelligence ladder waterfall (R2) — pts recovered per unlocked wall.
2. Defense failure Sankey (R2).
3. Shortlist regret bars by trick × role (R1).
4. Utility-leverage heatmap (R4).
5. VOI calibration scatter + reveal-value bars (R5).
6. Sampler marginal-vs-joint coherence table (R3).
7. Cosmo edge curve scatter + fit (R6).
8. Oracle-contamination dose–response line.
9. Final: virgin battery running paired pts/hand with CI funnel.

## 12. Pre-registered predictions (so results can grade the predictors)

**Claude:** shortlist modest (0.3–0.8 legal regret); defense tree plurality
in B with substantial E residue; utility map lights up widow + near-cliff
defense only; sampler meaningfully joint-incoherent even where marginals fine.

**Reviewer:** shortlist small overall, possibly surprising on opening leads;
utility small in ordinary play, material near contract/cliff + widow; defense
recoverable chunk mostly world-model/sampler; sampler worse than fallback
rate suggests; belief25-J modest alone, larger with joint sampling; VOI
real (boss/trump info > generic cards) but doubts the stack can *identify*
the highest-VOI card; BidBot-v1 real but incremental.

## 13. Fleet log — status at plan time (2026-08-08 ~21:00 MT)

**What the five boxes are doing:** the Gen25-RC1 self-play **belief corpus
soak** — full assembly mirror (cp1·wm1·bb0@τ0.05·bel15 both sides), duplicate
decks, `--dump` + `--dump-actions`, 300 pairs (600 games) per box, seeds
`71071949 / 142102949 / 189094727 / 252115727 / 88450313` (box1..5),
~69–74 s/game, 14 workers each.

| box | host | file | progress at plan time |
|---|---|---|---|
| 1 | hil-1 (5.78.115.122, hub) | `runs/belief/soak_box1` | 506/600 |
| 2 | hil-6 (5.78.130.139) | `runs/belief/soak_box2` | 520/600 |
| 3 | hil-4 (5.78.135.83) | `runs/belief/soak_box3` | 594/600 |
| 4 | hil-2 (5.78.128.203) | `runs/belief/soak_box4` | 586/600 |
| 5 | hil-7 (5.78.145.180) | `runs/belief/soak_box5` | 414/600 |

**Disposition (Riley's call, 2026-08-08):** the soak is exactly the new
plan's background corpus, so it runs to self-termination (duel.py exits after
its 300 pairs; nothing else is queued). An MBP-side watcher rsyncs
`runs/belief/` from all boxes every 15 min until complete (log:
`runs/belief/sync_watch.log`). After self-termination the fleet is **idle by
design** — no keepers armed, nothing respawns. The next thread re-arms boxes
per this plan (Phase-1 kill-switch instrument + Phase-2 gates + twin soak).
Earlier rung shards (`rung1_box{1,2}`, 356 games) already synced.

**Re-arm (2026-08-08 ~22:45 MT, Riley's go — don't wait on stragglers):**
box5's soak stopped by hand at 470/600 games (all keepers — mirror games are
independent); boxes 1–2 left to self-finish. Corpus closed at ≈2,870 games,
stats in `runs/belief/README.md`. New fleet law this week: **every run
self-terminates in ≤ 12 h; no keepers; check-ins every ~4 h decide
continue-vs-pivot** (boxes leave the family ~2026-08-15).

| box | workload | window | seeds |
|---|---|---|---|
| 3 (hil-4) | bid-twins **r4** (BidBot-v1 corpus, core=anytime, τ n/a, win 505) | 11 h self-stop | 24e9 + 3e8 |
| 4 (hil-2) | bid-twins r4 | 11 h self-stop | 24e9 + 4e8 |
| 5 (hil-7) | bid-twins r4 | 11 h self-stop | 24e9 + 5e8 |
| 1 (hil-1) | **oracle-contamination p=1.0** vs clean RC1, 250 pairs (on soak exit, via `scripts/contam_arm.sh`) | ~10.5 h | DEV 3e9+1e7 |
| 2 (hil-6) | oracle-contamination p=0.5, 250 pairs | ~10.5 h | DEV 3e9+2e7 |

p=0 control = the banked mirror soak itself (50.0% by construction). p=0.25
runs at the next rotation only if the 0.5/1.0 doses say the curve is
interesting. `--contam-a` lives in `duel.py`/`anytime.py` (Phase-0 commit).

**Corpus intended use:** belief25/belief25-J training rows (mill via
`belief25.py`), R2/R3/R5 decision banks (full deals + every decision +
replayable seeds), win-prob refresh states. See `runs/belief/README.md`.

---

*Numbers are measurements; gates are law; thresholds precede results.*
