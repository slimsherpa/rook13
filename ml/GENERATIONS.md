# The Generation Ledger

Every AlphaRook generation: how it was made, what it measured, what it
taught. Failed lines are first-class entries — the graveyard is where the
laws come from. Numbers are duplicate-deck duels (seats swapped, deal luck
cancelled) unless noted. "Sprint" = 500/−250 games; "marathon" = 4–10× the
hands, which compresses luck and amplifies true skill (repeatedly proven
the honest format).

**The laws** (each earned by at least one dead experiment, most by several):

1. **Stop at the bank.** Nets drift past their peaks; promote from banked
   checkpoints, verified fresh-seed at scale.
2. **The banking mirage** (5 sightings): duels under ~100 pairs read 10–20
   points hot. Nothing under 100 pairs + a marathon counts.
3. **Converged trunks churn under continued DMC** (12+ experiments): any
   full-net outcome-regression fine-tune of a converged champion degrades
   it faster than the new signal improves it. Root cause is statistical:
   outcome targets are ±1-scale noise carrying the variance of the deal
   and ~400 other decisions; near the optimum the true gradient is smaller
   than the noise floor.
4. **The only safe weight surgery is zero-init grafting**: add new input
   columns as zeros (function-preserving), train them (frozen trunk or
   gentle lr). Born gen13; reused for v3 dealer sense and the gen21 warm
   start. Net2Wider widening is the same idea for capacity.
5. **Bid pacifism is rational, not a bug**: vs a frozen greedy champion,
   mix-0.5 DMC learners repeatedly drift bid-passive (auction counts are
   the fingerprint). Curriculum or anchors needed, not exploration.
6. **Value-space distillation corrupts calibration** (4 strikes: gen12 ×2,
   gen14 ×2). **Action-space behavior cloning has a spotless record**
   (BC unlock, gen7 bids, gen21).
7. **Per-decision fidelity is not per-trajectory fidelity**: 87.5%
   bid-match compounded into a feral auction meta (gen21 draft 1).
   Warm-start from the incumbent so imitation only moves the delta.
8. **Population play needs frozen anchors + selection** (league S1) and
   exam seeds need salting (S5: all four cities unknowingly played
   identical exam decks — cross-city agreement was deal correlation).
9. **Search pays only where imagined worlds are true enough**: endgame
   gate t≥3; belief-posterior sampling moves the gate earlier; search
   below the truth threshold measurably loses.
10. **Engineered proofs set the bar, learned behavior ships** (endgame
    guard: simulation-proven, then reverted in favor of learning it —
    guardsim's score-states remain the exam).

---

## The ladder (shipped generations)

### gen1–gen6 — birth of the DMC line (2026-07-07/08, branch alpharook02)
QNet(state≈479+action 50 → 1), DouZero-style Deep Monte Carlo on full
games (target 0.7·win + 0.3·diff/500). What it took to get off the floor:
opponent-mix 0.5 vs scripted Standard (pure self-play drifts into a
private meta), per-hand reward blending (full-game win/loss is a cliff),
guided bid exploration + engineered hand-strength features, and finally
the **BC unlock**: behavior-clone Standard's card play (1.2M decisions,
92.3% teacher-match) then DMC fine-tune. gen6 = 81% vs Standard with
family bids — tied phase-1 PIMC in one forward pass.

### gen7 — learned bidding (2026-07-08) — biggest single rung ever
bid-BC then DMC vs Standard. 94.5% vs Standard; beat gen6-with-family-bids
63/37 on identical cards, winning MORE contracts at LOWER bids. Rook is a
bidding game and learned bidding is measurably better.

### gen8–gen10 — the champion ladder (2026-07-09/11)
Each trained vs the frozen previous champion (opponent-mix anchor), banked
by duel. gen8 63%, gen9 (first FULLY neural, trump-intent-first widow)
57.5%, gen10 55.3% — **narrowing rungs = the 660k MLP nearing its
reflex ceiling**. gen10 shipped to browser (raw-weights forward pass in
TS, no onnxruntime). Trump-intent-first design (declare trump before
discarding) vindicated Riley's "humans pick trump first."

### gen11 — search + learning (2026-07-11, config not checkpoint)
gen10 inside PIMC: K=24 worlds, Q-prior shrinkage (rollout+w·Q)/(K+w)
(fixes the winner's curse that made raw PIMC over-bid), **endgame gate
t≥3** (search only where voids pin the worlds). 53.3% sprint / 65%
marathon over gen10. Browser port at K=8 t≥5.

### gen12 — value distillation: CLOSED after 2 honest negatives
Search self-play corpora (5k then 16.2k games), weighted-MSE value
distillation into gen10. Epoch duels read 54–60%; fresh-seed confirms 47–51%.
Taught the banking mirage, load-bearing anchor rows, and strike 1+2 of the
value-distillation law. Corpus format stored ENCODED states — unusable
when the encoder evolved (why gen21's corpus is raw-replayable).

### gen13 — THE BELIEF NET (2026-07-12/13) — champion reflex for 13 days
encode_state_v2 = v1 + 29 belief features (unseen counts/boss ranks/
per-seat exposure). **Zero-init graft onto gen10 + two-stage training**
(freeze-trunk 6k iters, then unfreeze at lr 5e-5) — full-net fine-tune had
DECLINED 37.5→17%. 52% sprint / 60.7% marathon over gen10;
gen13×search beat gen11. The graft maneuver became the project's
signature move.

### gen14 — blunder engine shipped; blunder MODELS failed (2026-07-13)
audit.py: hindsight (counterfactual playouts in the TRUE world) ×
knowability (deep search agrees) ⇒ preventable blunder. Measured: gen13 =
gen10 = 0.72 preventable/hand (~170 pts); 75% in tricks 1–4; declarer =
2× blunder rate of any other seat. Model attempts (MSE, then pairwise
rank loss on hindsight values): rank version CUT blunders 29% and still
lost 33% overall — strikes 3+4 of the value-space law ("won its metric,
lost the game").

### gen15 — belief head organ (2026-07-14) — parity on strength, organ kept
Net2Wider ×2 (2.75M params) + belief head off the FIRST hidden layer
(linear probe off the last layer provably can't learn it): who holds each
of 40 cards, 44.7% acc. Strength parity → NOT promoted; the organ became
gen16's imagination.

### gen16 — belief-guided search (2026-07-14) — champion stack
Worlds sampled from gen15's belief posterior (temp 0.5 > 0.3/0.7/1.0)
instead of uniform: +7.6% truer worlds, biggest lift tricks 1–4.
**56.7% sprint / 68.6% marathon over the gen13 stack** — most lopsided
marathon ever. Plan trees and fork search all LOST (fusion law: per-world
max prices flexibility as value); world-truth ≳40% is the search gate.
Role audit: the stack is a declarer-play fix (−21% declarer blunders).
Browser = two brains (gen13.bin + gen15belief.bin), K8.

### gen17–gen19b — the four failed attacks on the reflex (2026-07-15/22)
- **gen17 exploiter**: 460k games probing frozen gen13 → 39%. Bid-passive
  fingerprint. gen13 withstood everything.
- **gen18 scale**: Net2Wider ×2, 5e-5 (1e-4 arm died first day), ~400k
  games → 46-47% flat. Twin-cosine showed capacity engaging; strength
  didn't follow at this budget.
- **gen19 expert iteration**: champion-stack as behavior policy, vanilla
  DMC rows → 45%. The rows were still outcome-noise (the targets, not the
  behavior, were the bottleneck — the insight that later made gen21).
- **gen19b** (search from trick 0, near-floor eps): 52% bank → 50.0%
  sprint → 46.4% marathon. Mirage sighting #5.
- **REFLEX LINE CLOSED** (f9c1796): "do NOT green-light attempt #9
  without a fundamentally different training channel."

### gen19 (shipped bot) — sharper browser gate (2026-07-22)
Not new weights: gen13 reflex + gen15 belief + K8 search from trick 3
(vs gen16's 4), duel-validated t3>t5. Camp roster cascaded: Cosmo=gen19,
Cougar=gen16, Puma=gen13.

### gen20 — the gyms (2026-07-22/24): dense objectives, sim-real gaps
- **Hot-seat gym** (per-role points/hand, search-assisted stream): taker
  +6.5–7.5 pts/hand — first real training gain of the era — but composite
  graduation FAILED 37/26% (gym had no real auction → set-cliff blindness
  + OOD auction features). Anti-champion defense skills didn't transfer
  (era-mixing = law).
- **Bidding gym** (outcome model + auction-only episodes, no-floor rule):
  learned 495-endgame discipline (92.0% at 495v300, beating the engineered
  guard's benchmark — Riley's "it should LEARN" requirement met) but open
  play failed (outcome model blind to defenders' hands). v2 spec: real
  playouts. Superseded by the league, then the mimic.
- **League S1–S5** (population, sugar cultures, natural selection):
  S1 unanchored → feral overbid meta (ruler 18%). S2 anchors+selection.
  S3 shaped-sugar-in-target DIAGNOSED as target redefinition (17% in 1h).
  S4 native-target still decays → the churn law is about DMC itself.
  S5 freeze-trunk (only v3 dealer columns learn): first league that
  cannot degrade; 6h/95k games/city → no detectable gain (+1.2%±1.4%
  within-lineage); exam-seed correlation + post-swap fitness labeling
  bugs found at archive time. Verdict: selection hygiene works, gradient
  drip too slow; superseded by the mimic channel.

### gen21 — THE MIMIC (2026-07-24/25, branch alpharook11) — reflex champion
**The channel change the seven failures demanded: action-space behavior
cloning of the champion stack.**
- **Teacher**: gen13 + gen15 belief(0.5) + K24 t≥3 — measured **62.6%**
  vs bare gen13 over 1000 games (150 sweeps to 24; a declarer-play edge:
  same bids, 67% vs 60% make-rate).
- **Corpus**: gen_mimic.py — teacher plays all 4 seats on the fleet
  (~15s/game/core, ~139k games/day); records are RAW (seed + actions,
  replay-self-checked every game) so any future encoder re-mills them;
  40% score-curriculum starts (half near-endgame); ~450 decisions/game,
  ~34% searched, ~11% overrides (search ≠ reflex — the pre-labeled
  needles).
- **Encoder v4** (530): v3 + auction transcript (engine bid_history —
  who opened, raises per seat, backed-out flags). Leak-tested.
- **Draft 1 (mimic1-a, from-scratch 2.17M net): FAILED 38.3%** — quiz
  62%/37% ovr but 87.5% bid fidelity compounded into 2290-vs-1461
  contracts at 55% make. Law 7.
- **Draft 2 (mimic1-b, gen13 warm-start via graft_v4, lr 5e-5, override
  rows ×4)**: step-0 = gen13 exactly (98.4% bid match, 0% ovr);
  step-50k checkpoint = **models/gen21-cand1.pt**.
- **Results (fresh seeds)**: 55.6%/1000 sprint (sweeps 114–58) +
  **60.5% marathon** (28–7) vs gen13 — first reflex past the champion
  after 8 failed attempts and ~24M games. Gauntlet at 2500 games/matchup:
  54.7% sprint / **68.9% marathon (−2500..5000)** vs Puma; **parity with
  the PRODUCTION search stacks in sprints** (49.1% Cougar, 48.8% Cosmo)
  — a reflex as strong as the K8 searchers; search-marathons FINAL:
  44.5%±2.4 Cougar / 46.5%±3.0 Cosmo — the stacks' true edge compounds
  in the grind, so the stack line stays ahead until gen21×search is
  examined. Full table + raw dumps: history/gen21-gauntlet/.
- **Hand-pair decomposition** (Riley's luck-vs-skill question, sprint vs
  Puma, 12,465 aligned mirrored hands): 73.7% cards-decided, 26.3%
  skill-decided, gen21 takes 53.4%±1.7% of the skill hands at +114 pts
  avg swing; marathon replication over 206,103 hand-pairs: 74.3% cards,
  54.3%±0.4% of skill hands, +116 — the small per-hand edge that
  compounds into 55% sprints and 69% marathons, measured to ±0.4%.
- **mimic1-c** (widen×2-then-graft, 2.17M): same recipe, better quiz
  (92.7% bid / 28.3% ovr at 50k), same strength (54.9%/1000) — the
  graduation replicates across architectures. Still training.
- **Not yet done**: composite exam (gen21×search×belief vs gen19 stack),
  guardsim endgame-bid battery, role-split audit, TS ship (engine.ts
  bid_history + encoder v4 + parity fixtures), formal minting.

### gen22 — THE DARWIN GYM (2026-07-25, branch alpharook12) — IN PROGRESS
**Riley's design: evolution on top of gen21, fed a contested-deal
curriculum.** The goal: a fighter that beats frozen gen21 60%+, then
production. Three genuinely new ingredients vs the eight failed reflex
attacks: (1) marathon training games (−1000..2000, luck compressed 4x);
(2) the contested-deal curriculum — `contested.py` dithers gen21 (softmax
temp 0.2, ~11% deviation) K=8 times per deal and scores contestability by
swing spread + winner-flip rate; a third of deals are dither-proof
(the true slam dunks) and get downweighted, attacking law 3's root cause
(outcome noise from rows no decision could change) at the DATA level;
(3) selection hygiene from S5 done right — banked-best cloning, salted
held-out exams, so gradient churn gets culled instead of compounding.
- **`evo.py`**: per city, 6 learners (born = gen21 byte-copies) + 2 frozen
  gen21 anchor seats (Riley's rule; law 5/8 gravity). Elo matchmaking,
  shaped sugar rows (S1's delivered-contracts rule), selection every 2h:
  everyone sits the same salted exam (24 mirrored marathon pairs vs frozen
  gen21 on held-out contested decks), bank bests, clone top-2 over
  bottom-2, pedigree names (`B.c450.c1231`). Exams log Riley's skill-share
  per contest tier (of skill-decided hands, the fighter's take — gen21's
  own edge was 53-54%).
- **Four cultures**: provo = Riley mix (15/35/50 calm/mid/contested),
  orem = hard-contest (2/18/80), logan = hot (lr 1e-4, eps 0.12,
  hand-heavy sugar), moab = **CONTROL on random decks** — if curation is
  the active ingredient, moab must fall behind; that isolates the
  variable law 3 says matters.
- **`worldcup.py`** (hub, daily 14:30 UTC): round-robin of city champions
  + frozen gen21 on salted held-out contested decks; ≥55% vs gen21
  auto-triggers the random-deck promotion battery (150 sprint + 70
  marathon pairs — curated skill must transfer to the true deal
  distribution before anyone is crowned).
- **Dashboard**: `scripts/evo_status.py` → http://5.78.115.122:8080/ —
  goal bar, per-city sparklines, pedigrees, skill-shares, cup history.
- Fleet: 4 boxes self-assemble via `scripts/evo_keeper.sh` (library build
  ~1h → gym; nightly +12k-deal refill to 120k). mimic1-c stopped and
  archived at its 50k-step checkpoint (graduated, parity with gen21 —
  its verdict was already banked).

### The other loop forward (gen23+, parked)
Wrap search+belief around gen21 → new teacher (starts from Cosmo-parity,
should exceed the 62.6% teacher) → regenerate raw corpus → warm-start
clone → examine. If the Darwin gym plateaus, this is the proven channel.
