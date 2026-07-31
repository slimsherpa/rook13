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
  ~9 min → gym; nightly +12k-deal refill to 120k). mimic1-c stopped and
  archived at its 50k-step checkpoint (graduated, parity with gen21 —
  its verdict was already banked).
- **Launch-night findings (2026-07-25/26), all fixed same night:**
  (1) engine redeals fire AT DEAL TIME — a single-deck deck_fn spun
  _advance forever (~1/6k deals), froze all four library builds;
  (2) "reshuffle until anchors apart" matchmaking = infinite loop once
  the never-exploring anchors' Elo ran ~450 clear of the eps-noised
  field — all four cities froze at rd ~100 simultaneously; separation
  must be deterministic; (3) **S3's law re-confirmed on gen21**: launch
  sugar (bid .10/pts .15/hand .25/game .50) redefined Q's currency and
  collapsed all learners to 0-7% vs gen21 in ONE 2h cycle — fingerprint
  was make-rate 41% vs 75% at IDENTICAL auction behavior (mispriced
  hands, not mis-bid counts). Fix: native proven target only
  (hand .5 / game .5, zero bid/pts sugar) + **the ratchet floor** —
  every founder's bank is seeded with pristine champion weights at
  its mirror-true 50%, so the cull pulls wrecked fighters back to
  fresh gen21 clones; the population can never do worse than restart
  from the champion. logan's lr also 1e-4 → 5e-5 (1e-4 is twice-proven
  fatal to champion inits).
- **(4) THE REAL DISEASE, then the cure (v2, same night): gen21 is a
  BEHAVIOR CLONE — its outputs are CE logits (measured −111..+52), not
  values (gen13: ±1). NO value-regression channel can touch it: even the
  native proven target re-scaled the function to 0-3% within one cycle
  (gen6's "MSE rescales BC logits", at gym speed). And plain CE
  self-imitation on marathon mirrors ALSO decayed — by mid-game the two
  mirror games sit at different scores, so "you outscored the mirror"
  credits context, not play.** v2 = THE MIRRORED-HAND FARM: training
  unit is a single-hand duplicate pair vs frozen gen21 (learner
  eps-dithered, champion argmax, same curated deal + same gen_mimic
  score-start both chairs); adv = d1−d2 is zero-sum-clean; adv>0 →
  CE-clone the learner's lines (weight |adv|/200 cap 1), adv<0 →
  CE-clone the CHAMPION's lines back into the learner (self-stabilizing
  pull). Marathon contested exams unchanged. First smoke selection:
  fitness centered ~60% (75/67/58/42 at 6-pair noise) vs the value
  build's 0-3% — channel validated, fleet redeployed on it.
- **Day-1 verdict of the farm channel (2026-07-26 am): SAFE, at PARITY,
  not yet a rung.** Overnight: populations 48-54%, pos_rate (beats-champ
  hand rate) climbed 22→38%, 3-generation pedigrees formed. First world
  cup: gen21 finished LAST of 5 (orem 58%, moab 55%, logan 54%, provo
  50% vs gen21 on fresh contested marathons; pooled 54.2%/400g) and
  orem's 55% auto-triggered the random-deck battery: sprint 50.3%/300g,
  marathon 55.7%/140g — but the independent 500-game marathon confirm
  said **exactly 50.0%** (49 sweeps each): banking-mirage sighting #6;
  the 57-62% banked highs were max-over-noisy-exams froth on an honest
  50% population. SHARPENERS deployed, fleet restarted fresh: (a)
  needle-weighted CE — every learner decision is checked against frozen
  gen21's choice in that state; verified-win rows that DISAGREE train at
  4x (the mimic override lesson: the deviations carry the signal); (b)
  confirm-before-banking — bank overwrites must repeat on a second
  salted paper and record the confirm value (smoke: a raw 62.5% was
  confirmed at 50% and refused). RILEY'S RECHECK (his skepticism,
  validated): the cup's drama did not replicate — orem's champ on the
  CUP'S OWN contested decks at 5x scale = 52.4%/500g (skill-share
  48-49% in every tier), plus 50.0%/500g on random decks ⇒ parity
  everywhere; "gen21 finished last" was three compounding illusions
  (100-game pairings ±5pp, someone-must-finish-last in a round-robin
  of equals, winner's-curse entrants). Mirage sighting #7 — at CUP
  level; confirm-before-banking now guards every surface. Open
  question the next days answer: ANSWERED 2026-07-26 pm — FLAT. The
  48h verdict at full guardrails: needle-4x measurably harmful (44.6%
  pooled, reverted); then the double-gate's first two survivors (orem
  54.7% confirmed; moab 58.7% confirmed with ALL SIX fighters 53-59%)
  both died on 1,300-game replication batteries (orem 49.0/50.6/51.7;
  moab 48.6/48.4/51.7) — mirages #8 and #9 — and provo's sel-3 57.3%
  confirmed bank followed (50.6/49.0/46.3): #10. All three cities'
  gate-survivors replication-killed; verdict triple-sealed. NEW LESSON for law 8:
  six near-identical fighters sharing one exam paper are ONE correlated
  draw, not six confirmations (S5's deal-correlation trap, within-city
  edition) — population-wide "agreement" on shared papers proves
  nothing. VERDICT: the mirrored-hand farm preserves perfectly and
  discovers nothing at this budget — eps-scale deviations that beat the
  champion's line are too rare/shallow to compound. Gym archived
  resumable; pivot per the pre-agreed rule to the mimic loop (gen23:
  teacher = gen21 x search x belief, ceiling measurement launched).
  Old open question, retired:
  does concentrated needle signal + honest selection produce a real
  climb, and does moab (control) lag? If flat by ~48h, the proven
  fallback is the mimic loop (gen21×search teacher → gen23).

### The other loop forward (gen23+, parked)
Wrap search+belief around gen21 → new teacher (starts from Cosmo-parity,
should exceed the 62.6% teacher) → regenerate raw corpus → warm-start
clone → examine. If the Darwin gym plateaus, this is the proven channel.

### gen23 — THE T0 CORPUS (2026-07-27/29, branch alpharook12) — IN PROGRESS
**The mimic loop, activated. Teacher = gen21 × gen15-belief(0.5) × K24
PIMC from the OPENING LEAD (t0), the strongest player this project has
ever measured.**

**Teacher selection (the three-arm bake-off, all marathon duplicate-deck):**
- t3 stack 74.7% vs bare gen21 (n=810); t1 74.9% (n=466) — t1 beats t3
  head-to-head 53.9% (p=0.007) but buys NOTHING where it counts and costs
  1.47x per needle. Closed.
- **t0 = 78.5% vs gen21 at n=10,046 (±1.0pp)** — the only gate that
  searches the opening lead, and law 9's gate finally moved: belief
  posteriors make trick-0/1/2 worlds true enough to profit (gen16-era
  uniform worlds measurably LOST below t3).
- Hand-level mechanism (hand_analysis.py, 51k hands): t0 wins only ~54%
  of hands (+11 pts of ~120) — but it CONVERTS luck-hands into
  skill-hands (22.8% of hands skill-decided vs t3's 19.6%, p<1e-5) and
  its make-rate edge GROWS with contract difficulty (+5pp at bid 95 →
  +12pp at 110). Small per-hand edge × 68 hands = 79% of marathons.

**Corpus design (duel-dump format, duel.py --dump-actions):**
- Measurement runs double as teacher corpus: teacher (side 0) vs bare
  gen21, every game replay-verified before it is trusted, BOTH sides'
  decisions kept (replayability) with a side flag — only teacher rows
  train; the opponent's lines are what the warm-started student already
  is. Records stamp win/lose so the miller never guesses the format.
- Teacher-vs-gen21 chosen over teacher-vs-teacher: same teacher rows per
  compute-hour, 2x the deal diversity, and the duel doubles as the
  measurement.
- **Format mix: ~85% marathon (2000/−1000) + ~15% standard (500/−250).**
  Measured justification: 69% of marathon teacher rows sit AT the
  encoder's hand_number cap vs 3% in standard games (the OOD risk);
  near-threshold score coverage is fine in both (~18%) because score
  features are fraction-of-target by design.
- Conversion (measured): marathon game ≈ 69 hands ≈ 1,500 teacher rows
  ≈ 107 needles; standard game ≈ 13 hands ≈ 300 rows ≈ 22 needles.
  Needle density 7% of teacher decisions — 2x the gen21 corpus (t0
  searches the early tricks, where reflex disagreement lives).
- Fleet: 5 Hetzner boxes × 4 streams + Riley's MBP × 3 streams (the MBP
  out-produced every box ~2x per core). ~21-27M rows/day, ~$25/day.
- **Sizing ladder** (anchored to gen21's proven 30M-row/1.1M-needle
  recipe): Good 18M / Great 30M / Excellent 45M (train here) / Ideal 75M
  (past which steps, not data, bind). **45M rows + 3.2M needles banked
  in ~48h — 3x gen21's needle budget off a 2.5x-steeper teacher.**

**Engineering laws earned this round:**
- **Streams must be resume-safe** (duel.py completed_pairs): a killed
  stream otherwise replays its whole seed space at full search cost.
  Keeper relaunches + OOM kills + laptop sleep all made this real within
  the first day. The miller dedups on (seed, flip) for half-pairs.
- **pkill of a duel parent orphans its spawn-pool workers** — they run
  forever at full CPU with PPID 1. Two-day-old orphans were found eating
  3 cores. Always sweep `ps -eo pid,ppid ... $2==1` after any stream kill.
- **A write-time field filter eats your new fields silently**: the
  win/lose stamp was added to the record but the corpus writer's
  explicit key list dropped it — caught only by auditing actual rows an
  hour into production. Audit the artifact, not the code.
- Incremental byte-offset counters (corpus_count.py) or the status board
  re-reads GB shards every 2 min by day two. macOS crontab HANGS from
  non-interactive shells (TCC) — LaunchAgents instead.

**The clone (gen23-mimic1, trained 2026-07-29 on the hub):** warm-start
from gen21-cand1 (--hidden 512,512,256, lr 5e-5, override ×4 — the
draft-2 recipe verbatim), 120k steps ≈ 61M rows at ~4,000 rows/s ≈ 4.5h
wall on 8 CPX41 cores. Quiz val = 494k rows / 42.9k overrides from 400
held-out games.
- **The curve's shape IS the lesson: the leap is immediate, the rest is
  calibration.** Needle-match jumped 1.1% → 20.9% inside the first 2,000
  steps (~1M rows, 2% of the corpus), then plateaued 19–21% for the
  remaining 118k steps while val loss kept falling (0.95 → 0.46) and bid
  fidelity recovered 96.2 → 97.9%. Reading: a warm-started student
  absorbs the teacher's *learnable* tendencies almost instantly; the
  ~80% of needles it never matches are heavily search-noise near-ties
  (Green 6 vs Green 8 with 24 sampled worlds tipping a hair) that no
  reflex can or should memorize. The long tail of training buys
  confidence calibration, not argmax changes.
- **Two candidates, picked by duel not quiz** (the banking rule starred
  step-2k best.pt at ovr 20.9%; latest.pt at 120k has equal ovr, better
  bids and best val loss — the gen9-era "latest often wins after stable
  runs" note applies): 4-arm fresh-seed screen vs gen21 launched on
  boxes 2-5 (sprint 750 pairs + marathon 400 pairs per candidate,
  screen_*.jsonl dumps). Corpus streams retired first — final bank
  ~2.5M hands / ~60M teacher rows / ~4.3M needles, raw and re-millable
  forever.
- **SCREEN + FULL GAUNTLET VERDICT (2026-07-30): gen23 = new champion
  reflex, MINTED models/gen23-cand1.pt (= latest.pt).** best.pt (the
  early ovr-bank) = 49.6% sprint AND marathon — pure parity; the quiz's
  favorite is not the player, the calibration tail is. latest.pt swept
  the ladder (18 arms, fresh seeds, duplicate decks): sprints — teacher
  39.6%(n=700) / gen21 52.2%(n=1500, +screen 53.0% n=1500) / Cosmo
  51.2% / Cougar 53.2% / Puma 57.1% / Cub 58.0% / Bobcat 60.7% /
  Kitten 61.8% / Stomper 62.1%; marathons — teacher 31.0%(n=200) /
  gen21 56.3%(n=1000 replication; screen 58.1% n=800 — REPLICATED, not
  mirage #11) / Cosmo 55.5% / Cougar 57.5% / Puma 66.2%(n=600) / Cub
  67.0% / Bobcat 70.0% / Kitten 72.8% / Stomper 72.2%. Perfect
  monotone staircase, marathon edge > sprint edge everywhere (the
  compounding signature), zero non-transitivity. A PURE REFLEX at
  parity-or-better with every production search stack, losing only to
  its own teacher. Artifact ("gen23 runs the gauntlet", 18 sketch-style
  cards per Riley's hand-drawn spec) published; dumps in hub
  runs/gauntlet/. NOTE for future dumps: seed/flip ride only with
  --dump-actions; sweeps from plain dumps = pair consecutive lines.
- **THE ALPHAGODROOK GAUNTLET (2026-07-30 overnight) — the ceiling,
  measured, and a law revised.** god.py (--god-a/b): exact-solver
  omniscient card play, gen21 bids — the one legitimate use of
  truth-conditioning (a referee with a chair; its games are training
  poison, law 9). ~2 min/hand; 12 arms, 6 machines, ~950 games.
  RESULTS (sprint win% / pts-per-hand / make%): teacher 92.0/+38/77,
  gen23 91.0/+40/80, gen21 89.0/+37/78, Cosmo 93.0/+44/80, Cougar
  95.0/+45/76, Puma 95.8/+45/83, Cub 91.0/+42/82, Bobcat 97.1/+51/86,
  Kitten 92.0/+47/80, Stomper 97.9/+53/85; marathons vs gen21 and
  gen23: 100%. **Across 460 duplicate-deck pairs: ZERO pairs swept
  against god — not one, by anyone, including the teacher.**
  **LAW REVISED — hidden information, not deal luck, is the wall.**
  The luck-floor argument ("the teacher only wins 63.7% of sprints, so
  99% is impossible") holds only between information-equal players; an
  omniscient +40-of-120 per-hand edge steamrolls sprint variance.
  Riley's "99% vs gen8" intuition was right ABOUT THE CEILING (god:
  97.9% and counting); every mortal sits far below it. Corollary: the
  space above the teacher is enormous, and the preventable/irreducible
  split (ceiling.py) is the map to how much of it mortals can claim.
  Full data + compressed dumps + era summary: history/gen23-era/.
  Method note: per-hand stats (pts/hand, make-at-same-bid) sharpen ~10x
  faster than game win% — they made 40-game arms readable overnight.

---

## Epilogue — the era ships (2026-07-30)

The gen23 era ended the only way an era should: everything worth keeping
made permanent, everything it built handed to the family, and the
machines that did the work deleted.

- **The corpus is immortal**: the fullest-ever consolidation (63,740
  games / 2.72M hands — bigger than the training headline; the hub's own
  copy was 13% stale) lives in `runs/t0shards/` (checksummed), zstd 10:1
  in `history/gen23-era/`, and off-site at `gs://rook13-corpus/`
  (Coldline, ~$0.001/mo). It can train every future student.
- **The teacher became Cosmo**: gen21+t0 (K24, trick 0) serves the
  family from Cloud Run (`service/` — nudge-based, ~$15-20/mo, browser
  gen19 as the outage cover). The roster cascaded a rung; gen8 retired.
- **AlphaGodRook sits behind a triple-tap secret unlock**, timeboxed to
  12s/solve — a god-lite in production, the full god in the ledger.
- **The solver became the referee**: the blunder detector replays any
  finished hand on request — per-play deltas, per-player leak totals,
  and PAR vs the bid ("the 100 was never makeable — perfect play takes
  ~90"), attacking the bidding leak the oracle measured. First live
  verdicts confirmed by Riley at the table.
- **The fleet is gone** (Riley deleted all 5 servers, 2026-07-30) —
  $25/day → $0. Total era compute bill: ~$50 of rented CPU for the
  corpus, the crown, and the ceiling.

Open road, when the itch returns: gen24 = the bid gym (the evidence
converged from two directions and now the blunder detector generates
live family evidence too); a Riley-and-brother marathon vs the teacher;
audit-the-go-down; and whatever the ladder looks like from above 90%.

---

# gen24 — THE BID GYM (opened 2026-07-30, running locally)

The itch returned the same day the fleet died. Full design doc:
`history/gen24-bidgym/README.md`.

The inversion: every previous gym evolved neural weights and banked
mirages; this one evolves **15 named genes** (`alpharook/bidgenes.py`) so
the equilibrium bidder can simply be read. Card play never varies — every
seat plays gen23 reflex; fitness is pure bidding. Games are the family
-250/+500, the format where one set is a cliff. At default genes the
genome IS the family calibrated bidder, byte-exact vs
`choose_bid("basic")` (tested) — every evolved delta is a legible delta
from the family's own calibration. Four poker genes the family bidder
doesn't have: `deficit_slope`, `desperation`, `protection`, `cliff_fear`.

Four cities on Riley's MBP (`alpharook.bidcity`): provo (balanced), orem
(hot), logan (cold start from random genomes — can bidding be
rediscovered?), moab (conservative control). 10 evolvers + 2 immortal
anchors (family, gen23-native-bids) per league; duplicate-deck
round-robin seasons, cull-and-breed; ~60+ seasons/city/hour at ~0.1
s/game. `alpharook.bidcup` is the cross-city championship on fresh decks
(law 2 lives there); `alpharook.bidprobe` is the curiosity instrument —
same hand × 7 auction scenarios × 9 score states, every bot's exact bid
recorded. `scripts/gen24_status.py` for the 10am/10pm check-in.

The questions this gym exists to answer: does aggression win? crawl or
jump? does the equilibrium bidder stretch when behind late (and how
much)? does anyone learn to fear the -250 cliff? — and does any of it
beat gen23's own auction, which was never the part of gen23 anyone
trained on purpose.

## gen24, night one (2026-07-31) — three attacks on the auction, one standing champion

The bid gym's opening night, run end-to-end while Riley slept. Verdict:
**gen23's auction is startlingly robust.** Three independent attackers,
three results at or just under parity:

1. **Gene cities (Act I, retired at 1,068 seasons)**: interpretable
   formula bidders cap at ~35% vs gen23's auction — two wildly different
   evolved strategies lost identically, so the wall was the family hand
   evaluator, not the policy around it. Diagnosis that reshaped the night:
   deterministic games + 4 decks/season made league fitness r=0.24-0.49
   season-over-season (champions churned 81-93% of seasons) — selection
   amplified deck lottery. Their 1.36M banked score-states became
   `winprob24` — the P(win | score) currency everything now prices in.
2. **AlphaBid oracle (Act II)**: sample worlds consistent with the bids,
   roll out with frozen gen23, argmax win-probability. Seven arms:
   deaf 31% -> listen 36% (+5pp: LISTENING IS REAL), K16->K64 +12pp,
   adaptive K24/96 45.0%±7.9 (n=120 pairs). Best arms 47-49%: the
   rollout oracle plateaus just UNDER the distilled equilibrium at
   laptop-feasible K. gen11's winner's-curse law, now measured: EV gaps
   between bids (~0.02 wp) sit at sampling-noise scale, and a mostly-
   raise option menu turns noise into overbuying. Fold-unless-clearly-+EV
   margins and empirical evidence models tame but don't beat it.
   Byproduct: **the dialect table** (19,852 seat-hands) — gen23's 65-95
   bids are one mute class (2.93±1.20 tricks); willing-to-100 = 3.12,
   105 = 4.02, 110 = 4.78, pass = 1.78.
3. **Partnership league (Act III, running)**: locked pairs modulate
   gen23's own Q-values (13 genes/partner; all-zero = byte-identical to
   the house, invariant-tested), mirrored-deck EMA fitness, gauntlet vs
   locked gen23&gen23 every 8 seasons. 271 seasons / 34 gauntlets:
   best oscillates 48-57%, median 47-53% — pairs live AT parity, never
   pull away. **No opening language emerged**: ladder steepness
   (monster-minus-junk opening level) median 1.3 bid-points — everyone
   inherited the house's mute ~99 crawl. What DID persist across
   champion generations: pass_bias +1, war_bias -2, partner_high -2,
   cliff_pass +2.7 — a calmer, cliff-fearing, war-avoiding gen23.

Law for the ledger: **a behavior-cloned equilibrium defends itself.**
The auction meta that looks "funky" from the outside — mute crawling,
buying at ~99, 100 as the price of everything — held off a formula
evolution, a Bayes-and-rollouts oracle, and 271 seasons of Q-nudged
population play, all on the same night. Whatever beats it will need
either a better hand evaluator than estimate_tricks (learned, not
tuned), search with far deeper world budgets than a laptop's, or a
convention system bold enough to escape the crawl basin — the open_gain
genes were too timid to bend argmax where Q-gaps are wide.
