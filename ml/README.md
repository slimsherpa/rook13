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
| gen12 (attempt) | distill gen11's searched play back into reflex weights (5k games, 3.3M search rows + 8.2M anchor rows, weighted-MSE from gen10) | **parity, not a rung**: 51.5% pooled sprint / 47.5% marathon vs gen10 at confirmation scale. Anchor-free ablation collapses to 28% (bid head drifts pass-ive without anchors); DMC on top of distillation rescales the edge away (46%). The loop machinery works — the signal needs ~10x more games or search-on-everything targets. gen11 remains champion |

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
- ~~search + learning~~ — **done (gen11)**: the champion net as PIMC's
  rollout/eval policy beats the pure net 65/35 at marathon rules; see the
  search notebook above
- AlphaZero loop, first pass (2026-07-12 overnight): `distill.py` — TRIED,
  parity. What the night taught: (1) 20-pair duel banking reads 15+ points
  hot (a 67.5% bank confirmed at 45.5%) — trust NOTHING under 100 pairs +
  a marathon; (2) anchor rows are load-bearing: without them the bid head
  drifts passive and the student collapses; (3) outcome-target DMC after
  value-distillation RESCALES the distilled signal away (gen6's BC lesson
  in new clothing). Next attempt needs 50k+ generated games (overnight
  generation-only run), search on all tricks for the targets, or repeated
  short distill cycles
- maybe: ship gen11 to the browser (TS port of search.py); learned world
  INFERENCE in the sampler; marathon-trained "grinder" variant
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
