# GEN24 — the 30-day improvement campaign (drafted 2026-08-02)

> **CAMPAIGN CLOSED 2026-08-05 — goal achieved in 5 days, not 30.**
> Final verdict: MortalRook +1.68 ± 0.80 pts/hand vs Cosmo over 83,604
> hands — the first confirmed card-play rung; the edge arrives at K48
> and does not measurably grow with K in real play. Fleet halted, all
> 5 boxes released. Era archive: history/alpharook-era/README.md;
> ledger chapter: GENERATIONS.md (bottom). Parked, priced next steps:
> budget-shaped production MortalRook; distill-to-browser mimic;
> BidBot (corpus banked); K-curve refinement to ±1 (~54k hands/arm).
> Everything below is the working log as it happened.

**The target:**

    gen24 = gen23 × belief × t0  +  Specialists( WidowBrain + CardBrain + CliffBid )

Cosmo (gen21+t0) is FROZEN in production and becomes the meter stick.
t0 search stays — it is the backbone, not a candidate for removal. The
campaign is 10 cycles × ~3 days, MBP cooking 24/7, optional Hetzner
burst for corpus cycles (proven ~$25/day, delete after).

## Standing constraints (each one paid for in blood — see GENERATIONS.md)

1. Search discovers, pairing measures, cloning transfers. Gradients and
   selection never discovered anything; don't ask them to.
2. Gate every specialist UNDER THE STACK IT WILL LIVE IN (WidowBrain's
   +3.80pp under gen23 play fell to +0.53 under gen21 play).
3. Per-hand stats before game win%; crown nothing under 1,000 pairs;
   confirm-before-banking; audit the artifact, not the code.
4. Specialists see the FULL human view (encoder v4), never more (labels
   may use hindsight; inputs never do), never less (house rule #1).
5. Test the test: ~20 minutes of corpus + audit + short train before any
   soak (house rule #2 — it killed CardBrain v1 in one evening instead
   of one week).
6. Never fine-tune the converged champion's weights (0/8). Specialists
   are fresh nets that OVERRIDE decisions; the champion absorbs them
   later via the mimic loop, the only proven "mash."
7. Truth-conditioned PLAY is training poison (law 9). The solver may
   labels-and-referee, never play-and-teach from omniscience.

## History that shapes this plan

**gen20 hot-seat ("trained per seat") — vindicated, not failed.** The
per-role, per-hand gains were REAL inside the gym (taker +6.5–7.5
pts/hand on luck-free fixed-deck batteries). Transfer failed for three
specific reasons, all now understood and all fixed by the widow-gym
pattern: (1) fake world — no real auction, so real-game states were
out-of-distribution; (2) wrong currency — raw points with no set cliff;
(3) wrong delivery — DMC fine-tuning of the converged champion (the
churn law). The widow gym is hot-seat done right: REAL states from real
games, REAL currency, fresh specialist net. Every gym below inherits
that pattern.

**CardBrain v1 (single true-world labels) — honest negative, banked.**
903k snapshots, quiz −3.2 ± 1.5 pts/override. Card-play advantage is
world-dependent; a true-world label teaches hindsight. v2 labels
marginalize over belief-sampled worlds at generation time.

**"Slowly blind AlphaGod" (Riley's idea) — half poison, half genius.**
The RL half (god plays, loses one visible card per 100k hands until
mortal) fights three laws at once: the habits learned at visibility V
are wrong at V−1 (finesse knowledge is binary), unlearning is the DMC
churn channel, and the endpoint is plain self-play (0/8). The genius
half: god's BRAIN with MORTAL EYES — sample K worlds consistent with
what the seat can see (belief-guided), EXACT-SOLVE each world, average
the values, argmax. That is a legitimate information-legal oracle,
stronger than t0's noisy rollouts wherever the solver is affordable
(trick ≥ 2, and the whole endgame). It becomes our best LABEL source
(CardBrain v4) and possibly a production endgame module. Same idea,
pointed in the ledger-legal direction.

---

## Surface 1 — go-down + trump (per hand)

Proven channel (WidowBrain v2: +3.80pp made, +8.5 pts/contract under
gen23 play). The ladder:

- **W1 — stack gate (cheap, first).** Re-gate existing WidowBrain v2
  under the assembled gen24 stack (t0 play). If the effect holds,
  it ships in the bundle immediately; only retrain if it shrinks.
- **W2 — full-view WidowBrain (house rule #1).** Current net sees 13
  cards + bid only. v3 adds scorecard, dealer, auction transcript —
  score-aware go-downs (protect at 460, gamble at −190) are unexplored
  headroom and cost one corpus regeneration + retrain.
- **W3 — label upgrade.** v2 captured ~1/6 of the mapped +30–48
  pts/contract. Levers in order of cheapness: more corpus epochs;
  stack-play rollouts for labels; solver-scored endgames inside the
  rollout (exact tail, rollout head).

## Surface 2 — card play (per hand)

t0 stays. Two parallel tracks: make the SPECIALIST that beats bare
reflex per decision, and make t0's OWN components better.

**CardBrain ladder (specialist):**
- **C1 (done).** v1 true-world labels: negative, closed.
- **C2 (in flight).** v2: label = mean advantage over K=8 belief-worlds
  (gen15 posterior @ 0.5), gen23 rollout continuation. Quiz gate:
  realized pts/override on fresh seeds, sliced by confidence tau.
- **C3.** Loud-row discipline + scale: train only where |mean adv|
  clears the sampling-noise bar (≥ ~2×sd/√K); K=16 on tricks 0–2;
  early-focus sampling; 3–5× corpus.
- **C4 — the mortal god.** Belief-sample worlds, exact-solve each
  (feasible trick ≥ 2), average, label. Solver-grade labels with mortal
  eyes; rollouts remain for tricks 0–1 only. This is the strongest
  label this project knows how to make.
- **Ship test at every rung:** quiz (per-decision twin) then hand-level
  gate: stack+CardBrain-override vs stack, duplicate decks, ≥1,000
  pairs, family format.

**t0 upgrade ladder (backbone):**
- **T1 — retrain the belief organ.** gen15's head is two eras old,
  trained on gen13-meta play. Retrain (bid-conditioned) on the gen23
  t0 corpus (63,740 games banked, re-millable). Truer worlds lift
  every search layer — the named-but-never-pulled lever since gen16.
  Gauge: world-truth % by trick (world_acc.py), then a stack duel.
- **T2 — solver endgame.** When ≤ 4–5 cards remain, exact-solve the
  belief-sampled worlds instead of rolling out (near-free, strictly
  better tails). Service + browser both.
- **T3 — adaptive K.** Spend worlds where the top-2 candidates are
  close (the bid gym's adaptive-K arm was its best); flat budget
  elsewhere. Latency-neutral strength.

## Surface 3 — bidding (per game, −250/+500, no marathons)

The house auction is near-Nash on AVERAGE states (three attacker
classes died at parity); the loud effects are score-conditional. So:
narrow the fight to where effects are catastrophic, and fix the
currency to the family game.

- **B1 — the currency.** Label everything in Δ P(win the −250/+500
  game), via winprob24 (the banked 1.36M score-state → P(win) table).
  A hand outcome converts to winprob(new score) − winprob(old baseline)
  — per-hand density, per-GAME meaning. No marathons anywhere.
- **B2 — twin-game corpus (BIDBRAIN.md v3, already designed).** Same
  deck, one bid deviation, deterministic play → the two games share
  every card; label = Δwinprob. One baseline prices all ~12 candidate
  bids of a sampled state. Stratify by score bucket; expect (and
  accept) label ≈ 0 in mid-game states — "relax, it's a wash" is
  itself the finding.
- **B3 — CliffBid, the narrow specialist.** Full-view net; may override
  gen23's bid ONLY when |predicted Δwinprob| clears a bar (cliff
  states: a set ends the game, enemy near +500, we near +500,
  deep-behind desperation). Everywhere else the house bids. Gate: game
  win% vs the pure house at ≥ 2,000 games (Riley's own extended law),
  family format, duplicate decks.
- Ammunition already banked: par says ~28–40% of bought contracts are
  unmakeable — the ceiling map (still growing) prices exactly how much
  the auction owes.

## Riley's role playbook (2026-08-02 — design fuel, verbatim spirit)

How the family actually thinks, per role. Feature/plan design for W2,
future organs, and any revived role work starts here:

1. **Declarer ("I took it")**: count trump OUT OF MY CONTROL; as they
   fall, read the distribution — lopsided = trouble, even = fine. Count
   LOSERS (cards that reasonably lose) and the counters riding on them —
   and EXPOSURE interacts with the go-down (a lone red 7 is safe when
   the red 10 and 13 are buried). The game: turn losers into winners —
   engineer partner leads to ditch losers on.
2. **Partner of declarer ("how can I help?")**: trump support tiers
   (1 good / 2 really good / 3 great); lead 14s to clean the declarer's
   losers out.
3. **Defender ("set them")**: sneak points — put counters on when
   partner is winning; find the LOSER SUIT and capitalize; VOID a lousy
   suit to ruff when it matters; time the counter gamble.

Note how role-shaped this is: the same observation demands different
plans by seat relative to the declarer. The gen16 role audit agrees
(declarer 2× blunder rate; partner-of-declarer easiest seat). Any
future role gym must keep real auctions, real currency, and specialist
delivery (the gen20 lessons).

## Assembly, benchmarking, and the "mash"

- **The bundle.** gen24 stack = gen23 × belief(T1) × t0(T2,T3) +
  WidowBrain(W-best) + CardBrain(C-best, tau-gated) + CliffBid(B-best,
  bar-gated). Each specialist rides only if its OWN gate passed under
  the stack; a failed gate = it stays home, no mercy.
- **CHAMP BENCHMARK (Riley's spec).** Every crowned gen_X plays the
  champ ladder: Cosmo (frozen teacher), gen23 bare, gen21, Puma —
  5,000 family-format games per matchup, duplicate decks, per-hand
  stats first (they resolve ~10× faster), win% for the crown.
  Confirm-before-banking; replication battery before any
  announcement (mirages #6–#10 all died there).
- **The mash = the mimic loop, nothing else.** No joint fine-tune of
  the champion (law 6). Once the bundle beats Cosmo at benchmark
  scale: the WHOLE STACK becomes the teacher, gen_mimic regenerates a
  raw corpus (rent 2–3 boxes ×48h if impatient), warm-start clone →
  gen25 single-net reflex that has absorbed every specialist. Then the
  browser bots inherit the whole campaign for free.
- **Ship discipline.** Interview-audit fixture per new decision path
  (the trump bug's lesson: byte-exact lab-vs-service parity BEFORE
  deploy, production audit after); env-var per specialist (WIDOWBRAIN
  pattern) so production rollback is a flag, not a build.

## The 10-cycle calendar (3 days each, parallel tracks)

| cycle | card play | widow | bidding | infra/assembly |
|---|---|---|---|---|
| 1 ✓ | v1 negative banked; v2 corpus | — | — | ceiling maps launched; house rules doc'd |
| 2 | v2 train + quiz verdict | W1 stack gate | B1 winprob currency check | belief retrain (T1) corpus prep |
| 3 | C3 loud-row + K16 | W2 full-view corpus+train | B2 twin-game generator + 20-min test | T1 training |
| 4 | mortal-god labeler prototype (C4) | W2 gate | B2 soak | T1 world-truth gauge + stack duel |
| 5 | C4 corpus | W3 if W2 short | B3 CliffBid train + quiz | T2 solver endgame |
| 6 | C-best hand-level gate under stack | — | B3 game-level gate | T3 adaptive K; assemble candidate stack |
| 7 | — | — | — | CHAMP BENCHMARK vs Cosmo et al (5k/matchup) |
| 8 | fixes from benchmark autopsy; re-gate losers | | | replication battery on the winner |
| 9 | — | — | — | mimic corpus from the winning stack (burst boxes) |
| 10 | — | — | — | gen25 clone + gauntlet + interview audits + deploy |

Slack is real: any cycle's negative result frees its slot; the
calendar bends, the gates don't.

## What we do NOT do (the graveyard, standing)

No DMC fine-tunes of champions (0/8). No value distillation (0/4). No
population/selection discovery (0/5 campaigns). No single-game binary
labels for ordinary bids. No rollout-oracle bidding at laptop K. No
omniscient PLAY in any training stream. No result believed off one
exam paper.

## The MortalGod ceiling run (launched 2026-08-02 19:59, ~24h)

Riley's call: measure the true mortal card-play ceiling instead of
judging it. `mortalgod.py` = god's brain with mortal eyes: at every card
decision, K belief-sampled observation-consistent worlds, every
candidate EXACT-SOLVED in each, values converted to family hand currency
(set = −bid) before averaging, argmax. Bids/widow/trump identical gen21
on both sides — card play isolated, per-hand currency (Riley's spec).
Cost trims, both conservative (the answer is a LOWER bound): champion
top-6 candidate pruning; worlds halved on tricks 0–1 (measured cost
2.4 core-h/game raw). vs the full Cosmo stack (K24 t0), duplicate
decks, dumps for hand-level decomposition. Priority order per Riley:
CardPlayer/WidowMaker optimization first (this run is its foundation),
BidBot after (calibration corpus banked, ~1.5k hands, generator ready).

## PROJECT ALPHAROOK — the fleet ceiling push (launched 2026-08-03)

Riley's mandate: find the TRUE mortal card player ("AlphaRookCardPlayer"),
per-hand currency, whatever the compute; distill-to-playable is a later,
separate project. Instrument: the mortal probe (per-decision, CRN worlds,
split-sample unbiased gains — the duel form failed exactly as gen11's
winner's-curse law predicted, first paired read 2-8). MBP night-1 result
that justified the fleet: perfect calculation beats Cosmo by ~+3.1 pts per
disagreement / ~+1.4 per early-trick decision (K12, n=407), biggest for
the declarer — real headroom, bandwidth-limited.

Fleet: 3× CPX51 Hillsboro (recycled gen23-era IPs) + MBP. Four arms of
the gain-vs-K curve, tricks 0–2, under Cosmo-stack decisions:
fk12 (8w box3 + 6w MBP), fk24 (16w box1), fk48 (16w box2), fk96 (8w
box3). ~24h. Where gain(K) flattens = the ceiling; the flattening K =
the thinking budget AlphaRookCardPlayer needs. Ops scars honored:
setsid+</dev/null for remote nohup; pkill needs the [b]racket trick or
it kills its own ssh session.

## TIER 0 — THE C ORACLE (landed 2026-08-04)

rook/csolver.c + csolver.py: line-for-line C port of the double-dummy
solver, ctypes-wrapped, auto-built on import (rebuilds on wrong-platform
binaries). **Parity-gated on macOS/clang AND Linux/gcc**
(tests/test_csolver_parity.py: identical values, 100+ real positions,
all depths, mid-trick, only= both branches). **Speed: 58–66×.**
Measured world-pricing cost (6 cands, 1 MBP core): trick 0 median 165ms
/ p90 1.28s; trick 1 median 23ms; trick 2 median 2.7ms. **The 8-second
budget buys K≈50 hard-case / K≈400 median on the opening lead at 8
cores** — production MortalRook is viable pending the duel verdict.
Mortal modules auto-prefer csolver (ROOK_PURE_PY=1 opts out).

C-era fleet campaign (launched 08-04): box1 = MortalRook K48 duel vs
Cosmo (1,500 pairs target), box2 = K96 duel, box3 = probe K192 + K384
curve extension. Sanity: MortalRook K48 took its first 4 games 3–1 vs
Cosmo. Ops: never rsync _csolver.so across platforms.

## ★ FIRST CONFIRMED CARD-PLAY EDGE (2026-08-05)

**MortalRook beats Cosmo, statistically confirmed, per-hand currency:**
K48 = +2.21 ± 1.92 pts/hand (14,609 hands) and K96 = +3.52 ± 2.57
(8,126 hands), both 95% CIs clear of zero — with K192 (+2.5) and K384
(+2.4) agreeing directionally on independent seed streams (four
independent arms, four positive means = built-in replication). The
signature is the honest one: identical bids, make-rate +2-3pp — pure
card-play conversion. After 11 failed attacks on the champion's card
play across three eras, the thing that finally worked: exact C-speed
calculation × belief imagination × split-sample discipline, at real
K, gated in real sequential play. The K-ladder keeps grinding to
tighten the curve's shape (does it keep rising past K96?).

## Verdict log (fill as cycles close)

| date | experiment | gate | verdict |
|---|---|---|---|
| 08-01 | CardBrain v1 (true-world labels), 903k rows | quiz 5k overrides | **NEGATIVE** −3.2 ± 1.5 pts/override |
| 08-02 | CardBrain v2 (belief K=8 worlds), 136k rows | quiz 5k overrides | **NEGATIVE** −2.7 ± 1.4; diagnostic: net fails to FIT its own corpus (33.7% donor agreement, 16.8% regret capture held-out) — representation/sample gap, not yet label bias |
| 08-02 | CardBrain v3 = advantage head on FROZEN gen23 trunk (law-4 graft), same corpus | held-out fit, then quiz | **NEGATIVE** — fit did not close (40.5% agreement but loud-row hits 35.6→28.2%, regret capture 16.8→12.5%); quiz skipped per gate. **CardBrain reflex-specialist LINE CLOSED at this design point** after three negatives (v1 hindsight labels / v2 belief-world labels / v3 champion-trunk features). Mechanism: per-decision card-play advantage is computed per-state by search and does not compress into a reflex advantage function at MBP corpus scale — the gen23 needle-plateau lesson, re-proven from the label side. Card play improves through the backbone (T1–T3) and the mimic loop. C4 (mortal-god labels) PARKED: labels were not the binding constraint, fit was. |
| 08-02 | T1 belief24 = belief head on frozen gen23 trunk, 8M supervised rows from t0shards replays (bid-conditioned, v4 encoder) | world_acc.py, 30 games × 8 worlds, temp 0.5, same seeds/policy vs gen15 | **PARITY** — 39.5% vs 39.6% sampled world-truth, near-identical every bucket; bid-conditioning bought nothing at trick 1 (35.3 vs 35.4). gen15's organ is meta-robust. Fingerprint: head saturated at 39% masked acc in ~30s → frozen-trunk FEATURES are the cap (gen15 was co-trained; belief-shaped features live in the trunk, not the head). Next levers if T1 is revisited: co-train a widened head + light trunk adapter (zero-init, law 4), or a sequence-model organ (bigger project). The organ ships nowhere; gen15 stays the stack's imagination. Drop-in ckpt banked at models/gen23-belief24.pt. |
| 08-02 | Treasure map COMPLETE (2,000 hands trick-3+, 240 hands trick-0) | ceiling.py + report | **The auction owes the most: 35.4% of contracts unmakeable at par** (median 15 pts overbid); makeable contracts converted 80%; per-decision play loss 1.75–1.99 pts at tricks 0–1 falling to 0.2–0.3 by trick 7; **71% (t3+) to 82% (t0-arm) of lost points PREVENTABLE**. |
| 08-02 | Arm A — THE FLYWHEEL: gen23×belief×t0 vs gen21×belief×t0, family format, 600 pairs | duplicate-deck duel | **NEGATIVE — the flywheel does not turn: 43.3%** (sweeps 70–150 against; make 61% vs 65% at same avg bid ~101). gen23 is the stronger bare reflex but gen21 is the stronger SEARCH CORE. **gen24's core = gen21×belief×t0 = Cosmo unchanged.** Consequence: every specialist gate must run under COSMO play; WidowBrain needs its v2.1 (gen21-rollout corpus) after all. |
| 08-02 | Arm B — solver-tail(4) on the gen23 stack, 600 pairs | duplicate-deck duel | **PARITY** (49.5%, +3.4 pts/game) — but tested on the wrong core; see Arm C on gen21. |
| 08-02 | Arm C — solver-tail(4) on the gen21/Cosmo core, 700 pairs | duplicate-deck duel | **PARITY** (50.7%, +5.2 pts/game, sweeps 107–97). Combined B+C ≈ 1,300 pairs: **T2 is a wash** — rollout-tail noise cancels across candidates (common worlds), and the reflex only leaks 0.2–0.5 pts/decision late (the map called it). Instrument kept (validated 120/120, ~free); T2 CLOSED as a strength lever. T3 (adaptive K) remains untried. NEXT on critical path: W1/v2.1 — WidowBrain retrained on gen21-rollout twin labels, gated under Cosmo play (corpus soak launched 05:57). |
| 08-02 | **WidowMaker v2.1** (Riley's name): 460k longest-trump contracts, gen21 rollouts, trained + twin-gated under gen21 play, 3,000 fresh contracts | twin gate ×2 | First gate (unmasked) read **−21.3pp — an artifact, not a verdict**: a net trained ONLY on longest-trump candidates hallucinates on the never-seen rest of the 2,860 menu. LAW ADDENDUM: **a focused-exploration corpus REQUIRES the matching deployment mask.** Masked re-gate: **−0.47 ± 1.24 — PARITY**, replicating the earlier v2 transfer test (+0.53 ± 1.24). Corpus forensics explain it: gen21's widow shows big HINDSIGHT headroom (38.7% of contracts beatable, +34 mean) but gen21 buries only ~13.8 counter pts (vs gen23's 19.0 in its error cases) — the conditional-on-observation headroom is ~zero. **The widow gold was gen23-specific; under Cosmo there is no widow edge to ship. W-track CLOSED for the Cosmo stack** (revives only if the play core ever changes). Campaign focus = 100% BidBot. |
