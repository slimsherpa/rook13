# AlphaRook — Deep Monte Carlo training (Phase 3)

The learning half of AlphaRook: a PyTorch value network trained by self-play
on **full games** (−250 → 500), making *every* decision — bids, all four
go-down discards, trump, and card play. The browser app never runs this code;
a finished brain ships later via ONNX. Nothing here touches Firebase.

## Layout

```
ml/
  rook/          Python port of the TS engine + heuristic bots
    cards.py     card/seat primitives (card = int 0..39)
    engine.py    rules engine (parity-tested against the TS engine)
    bots.py      random/basic/aggressive/cautious (decision-parity-tested)
    observation.py  the fair-play window — all an agent may ever see
  alpharook/     the learner
    encoder.py   Observation -> ~630 features (seat-relative, leak-tested)
    env.py       full-game decision stream (go-down = 4 sequential picks)
    model.py     QNet(state, action) -> expected final game result (~660k params)
    selfplay.py  vectorized self-play, one batched forward per step
    train.py     DMC trainer (fresh batch -> SGD -> repeat), logs + checkpoints
    arena.py     promotion ladder: net vs heuristics, sides swapped
  tests/         parity + leak tests
  runs/          checkpoints & logs (gitignored)
```

## The two contracts

1. **Rules parity.** `tests/test_parity.py` replays 24 complete games traced
   from the real TS engine (`GEN_TRACES=1 npx vitest run
   src/lib/alpharook/traces.gen.test.ts`) and asserts the Python engine
   reproduces every state transition AND the Python bots reproduce every TS
   bot decision. If the TS rules ever change, regenerate traces and this
   suite screams.
2. **No omniscience.** The encoder consumes an `Observation` only.
   `tests/test_leak.py` scrambles all hidden cards (other hands + go-down)
   mid-game and asserts the encoding is bit-identical. Cheating is a test
   failure, not a temptation.

## Training

```bash
cd ml
~/torch-env/bin/python -m pytest tests/ -q          # sanity first
~/torch-env/bin/python -m alpharook.train --run gen1 --iters 2000
~/torch-env/bin/python -m alpharook.train --run gen1 --resume   # continue
tail -f runs/gen1/log.jsonl                          # watch
```

Targets blend winning and margin: `0.7·win/loss ± 0.3·clip(diff/500)`.
Game scores are in the observation, so the net can learn endgame bidding
(desperate at −190, protective at 460). Eval runs every `--eval-every`
iters vs Easy and Standard; `best.pt` tracks the best Standard win rate.

```bash
~/torch-env/bin/python -m alpharook.arena --ckpt runs/gen1/best.pt --opponent basic --games 200
```

Throughput on the M-series MacBook: ~13k samples/s ≈ 100k+ full games/hour,
single process, CPU. (`--device mps` is available but small batches favor CPU.)

## Results so far (2026-07-07, full games vs Standard, sides swapped)

| Generation | Recipe | Result |
|---|---|---|
| gen1 | pure self-play DMC | 0–4% flatline (self-play meta doesn't transfer) |
| gen2 | + opponent mixing | 0% (full-game win/loss = reward cliff) |
| gen3 | + per-hand rewards, bid-eps | ~6%, pass-always bidding (0 bids won/109 hands) |
| gen4 | + hand features, guided bid explore | 0/141 bids — pacifism is *rational* with weak play |
| gen5 | play-only curriculum, from scratch | ~8–10%, slow log curve |
| bc | behavior-clone Standard's play (4 min) | **40%** (92.3% teacher-match) |
| gen6 | DMC fine-tune of the clone | **62.5% / +98 diff over 200 games** — beats Standard |
| gen6 overnight | +26k iters, 7 workers (2026-07-08) | **81% / +276 diff over 200 games** — ties the phase-1 PIMC search bot (81.7%), in one forward pass instead of 25 rollouts. Makes 79% of contracts at avg bid 98; sets Standard 42% (Standard sets it 21%) |
| gen7 | + learned bidding (script godown) | **94.5% vs Standard**; beats gen6 + scripted bidding 63/37 on duplicate decks — frozen as `models/gen7` |
| gen8 | champion-ladder vs frozen gen7 | beats gen7 **63/37** over 300 duplicate-deck games (87.5% vs Standard) — frozen as `models/gen8` |
| gen9 | first FULLY neural (trump-intent go-down; script none) | beats gen8 **57.5/42.5** over 400 games; 94% vs Standard — frozen as `models/gen9` |
| gen10 | ladder vs frozen gen9, 35k iters | beats gen9 **55/45** over 300 games; 94.5% vs Standard; beats gen7 66/34 (78/22 at marathon rules) — frozen as `models/gen10`, the reigning champion |
| gen11 | **search + learning**: gen10 inside PIMC (play search from trick 3, K=24 worlds, Q-prior 2) | beats gen10 53.3% over 300 sprint games — and **65.0% (+287, sweeps 13–1) over 80 marathon games**, the most lopsided rung yet once luck compresses; 94.5% vs Standard (saturated). No new weights: gen11 = gen10 × calculation |
| gen12 (attempt) | distill gen11's searched play back into reflex weights (5k games, 3.3M search rows + 8.2M anchor rows, weighted-MSE from gen10) | **parity, not a rung**: 51.5% pooled sprint / 47.5% marathon vs gen10 at confirmation scale. Anchor-free ablation collapses to 28% (bid head drifts pass-ive without anchors); DMC on top of distillation rescales the edge away (46%). gen11 remains champion |
| gen12-v2 | same recipe, 3.2x the data (16.2k games, 10.8M search rows + 26.6M anchor rows, 4 epochs) | **still parity — data was not the bottleneck**: epoch checks read up to 60% but confirmations say 51% sprint / 41.7% marathon. Twice-replicated: one-pass value distillation of a ~54% search edge into an already-converged Q net does not stick. Closing this line; the next real levers are a policy head + iterated cycles with exploration |
| gen13 | **the belief net**: 29 explicit card-counting inputs (unseen counts, boss ranks/flags, per-seat suit exposure) zero-init-grafted onto gen10, two-stage ladder (6k iters trunk-frozen, then full net at lr 5e-5) after run 1's full-net lr 3e-4 DECLINED 37.5→17% | 52% sprint but **60.7% marathon over 140 games (sweeps 20–5)** vs gen10 — a grind-shaped edge, exactly what fewer blown endgames looks like. Frozen-trunk stage alone banked 62.5% (belief features beat gen10 as a LINEAR add-on). **gen13×search beats gen11 55% (+38.5, sweeps 9–5): the new champion stack.** Frozen as `models/gen13`, browser BotStyle gen13 = belief reflex + endgame search |

League (2026-07-10, 300 duplicate-deck games per pairing): every newer gen
beats every older gen — no rock-paper-scissors, margins stack in order.
Marathon games (`duel.py --win-score 2000`, Riley's idea) compress card luck
~4x: the gen10-vs-gen7 edge grows from 657 to 783 per 1000 games.

Lifetime training totals (gen1-gen10): **~19.5M full games, ~253M hands,
~8.3B decisions, ~2.3B tricks, ~9.1B cards** (+~42k celebrated redeals at
the analytic 1-in-5,976 rate). Ladder margins narrowed as generations
absorbed their teachers (63 → 57.5 → 55) — so gen11 changed the axis:
instead of another rung of the same MLP, it multiplies the frozen champion
by look-ahead (`alpharook/search.py`, 2026-07-11).

## gen11: what worked and what didn't (the search notebook)

Raw PIMC with net rollouts LOSES — badly. K=8 search on everything went
5% vs pure gen10 by over-bidding (winner's curse: argmax over K noisy
rollout means picks the highest-VARIANCE action, and nothing is higher
variance than a big bid); K=8 on card play alone still lost 17.5%. Three
findings turned it around:

1. **Q-prior shrinkage** — score candidates by
   `(rollout_sum + w·Q) / (K + w)`: the champion's calibrated instinct
   counts as w pseudo-rollouts, so search only overrides the reflex when
   the look-ahead evidence is real (17.5% → 37.5% at K=8).
2. **The endgame gate is the unlock** — search only pays from ~trick 3 on,
   where voids and played cards pin the hidden hands down and imagined
   worlds are nearly exact. Early diffuse tricks belong to the reflex net:
   uniform world-sampling throws away the bid-inference the net learned
   implicitly ("she bid 105, she has trump"), and even K=32 full-hand
   search only breaks even (50%) while t≥3 search wins every config tried
   (60 / 58.3 / 56.7 / 53.3%).
3. **Likelihood-weighted worlds didn't help (yet)** — weighting each world
   by how plausibly the net would have made the observed plays inside it
   (`--infer` softmax temperature) was a wash at τ=0.05 and τ=0.2. The
   machinery stays in `search.py`, default off; smarter inference (bias
   the SAMPLER, not the weights) is future work.

Reproduce:

```bash
python -m alpharook.duel --a models/gen10.pt --worlds-a 24 --search-a play \
    --prior-a 2 --min-trick-a 3 --b models/gen10.pt \
    --script-a none --script-b none --pairs 150 --workers 7
python -m alpharook.arena --ckpt models/gen10.pt --worlds 24 --search play \
    --prior 2 --min-trick 3 --games 200
```

gen11 is Python-side only for now (~0.6s/game in 7-worker duels, ~100ms
per searched decision single-core); shipping it to the browser needs a TS
port of determinize + materialize + the lockstep rollout loop and a
per-move latency budget call.

Lessons encoded in the code: league mixing (`--opponent-mix`), per-hand
reward blending, curriculum staging (`--script openings|bid|none`),
BC warm-start (`imitate.py`, order-invariant go-down labels), and
per-decision-type exploration (`--bid-eps`).

## Roadmap

- ~~learn card play~~ / ~~learn bidding~~ / ~~learn go-down+trump~~ — **done**:
  gen9+ make every decision neurally (trump-INTENT-first go-down was the
  unlock; naive sequential discard cloning topped out at 59.5% teacher-match
  and 15% arena, intent-first cloning started at 50%)
- ~~ship as the in-browser AlphaRook brain~~ **done** — QNet is a plain MLP,
  so `export_web.py` dumps raw weights (`public/models/<gen>.bin`) and the
  browser runs them with a hand-rolled forward pass (src/lib/alpharook/
  qnet.ts + encoder.ts) — no onnxruntime needed. `neural.test.ts` replays a
  Python-traced game per gen and proves the live bots match the arena
  decision-for-decision (incl. gen9+'s widow flow and the deterministic
  trump-intent re-derivation). Freezing a new champion = add it to
  FULLY_NEURAL (if applicable) + re-run export_web.py + wire the BotStyle.
## The road to the top (agreed with Riley, 2026-07-13)

The family's verdict on gen13: strong instincts, real counting, but no
theory of mind and no plans — "it would never out-wit a human." Each rung
below builds the tool the next one needs. House rules throughout: nothing
promotes without 100+ pairs AND a marathon; honest negatives get archived;
two-stage grafts whenever a converged trunk is touched; browser ships only
what is provably identical to the arena champion.

- **gen14 — replay & blunder engine.** ENGINE SHIPPED (audit.py,
  2026-07-13); the fine-tuned MODEL did not survive confirmation — full
  findings below. The engine freezes any finished deal and interrogates
  every decision with hindsight: counterfactual playouts in the TRUE
  world find what the best card actually was, and a deep search from the
  observation says whether that was KNOWABLE — together they define a
  *preventable blunder* (hindsight loss + search agrees), as opposed to
  plain bad luck. First measurements: gen13 and gen10 both commit ~0.72
  preventable blunders per hand at ~170 pts each; 75% happen in tricks
  1-4; 69% cost 200+ (they flip hands). Model attempts: (v1) MSE toward
  hindsight values — 40.5%/21% vs gen13, make-rate collapse, calibration
  corrupted by compressed single-world targets; (v2) pairwise RANKING
  loss — cut preventable blunders 29% (0.72 -> 0.51/hand!) yet still
  lost 33% overall. **The four-strike lesson (gen12 x2, gen14 x2): ANY
  concentrated offline objective degrades a DMC-converged net's joint
  calibration, even when it wins its own metric.** Corrections must ride
  INSIDE the on-policy loop (MuZero-reanalyze style: a slice of each
  training batch from a periodically refreshed blunder buffer) — folded
  into gen15's training run rather than attempted offline again.
- **gen15 — belief head.** Bigger trunk (~2-4M params) with an auxiliary
  output predicting WHO HOLDS every unseen card (self-play gives the
  labels free), grafted two-stage. Replaces the hand-made belief counters
  with learned inference ("she passed then showed out of Red — trump is
  on my left"). Beliefs become readable/debuggable. Gauge: belief accuracy
  trick-by-trick + blunder-rate drop on the gen14 audit suite.
- **gen16 — belief-guided planning.** Search worlds sampled from the
  net's own posterior (uniform imagination is why early search loses
  today), extended to all tricks + a 2-3 trick tree so PLANS are
  evaluated as lines ("duck, ruff the third round, put partner on lead"),
  bidding included. Gauge: stack duels stop being coin flips; multi-trick
  blunder classes vanish.
- **gen17 — exploiter league.** AlphaStar's move: train agents whose only
  job is to find and abuse the champion's habits (synthetic humans
  hunting traps), fold their winning lines back into the league, repeat.
  Cure for off-distribution brittleness humans exploit. Gauge: each
  exploiter cycle needs longer to find a hole.
- **gen18 — legible partnership.** Hanabi-style: reward plays that make
  PARTNER's belief head more accurate — conventions emerge (its own
  dialect); possibly a sequence model so intentions persist across
  tricks. Gauge: pairs that signal beat pairs that don't.
- **gen19 — the human bridge.** Point the gen14 engine at the family's
  real Firestore games continuously; fine-tune against the lines humans
  actually punish; the JAY CUP becomes the official benchmark. Gauge: the
  family stops winning.

## Completed rungs

- ~~search + learning~~ — **done (gen11)**: the champion net as PIMC's
  rollout/eval policy beats the pure net 65/35 at marathon rules; see the
  search notebook above
- AlphaZero loop, first pass (2026-07-12 overnight): `distill.py` — TRIED,
  parity. What the night taught: (1) 20-pair duel banking reads 15+ points
  hot (a 67.5% bank confirmed at 45.5%) — trust NOTHING under 100 pairs +
  a marathon; (2) anchor rows are load-bearing: without them the bid head
  drifts passive and the student collapses; (3) outcome-target DMC after
  value-distillation RESCALES the distilled signal away (gen6's BC lesson
  in new clothing). v2 (16.2k games, 3.2x data) confirmed parity again —
  the distillation line is CLOSED at this design point. A future gen12
  needs a different shape: a policy head trained on search preferences,
  iterated generate-distill cycles with exploration noise, or search
  targets on every decision type. The 617-shard corpus (~16k games) waits
  in runs/gen12/data
- ~~ship gen11 to the browser~~ — **done (2026-07-12)**: src/lib/alpharook/
  search.ts ports the searcher at a browser-budget config (K=8, play search
  from trick 5, prior 2 — validated 54% vs pure gen10 over 100 games before
  porting); BotStyle 'gen11' is the lobby's top pick, runs on gen10's
  weight file, logs 🔮 per searched play
- maybe: learned world INFERENCE in the sampler; marathon-trained
  "grinder" variant; a policy head so search can prune beyond Q-argmax
- the real eval set: the family, at the JAY CUP

## Promotion protocol (for future generations)

1. Train with `--duel-every` so `best_duel.pt` banks peaks against the
   frozen champion (best.pt tracks the saturated vs-Standard metric — never
   promote from it).
2. Confirm at 150+ pairs (300+ games): 50-game evals swing ±10 points, and
   a 40-game bank can read 15+ points hot (gen10's 72% bank confirmed at 52%).
3. Compare `latest.pt` AND `best_duel.pt` — after long stable runs, latest
   often wins (gen10: 55.3% vs 52.7%).
4. Freeze `models/<gen>.pt` + onnx, archive the log to history/, export for
   web, wire the BotStyle, run both test suites.
