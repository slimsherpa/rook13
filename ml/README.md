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

League (2026-07-10, 300 duplicate-deck games per pairing): every newer gen
beats every older gen — no rock-paper-scissors, margins stack in order.
Marathon games (`duel.py --win-score 2000`, Riley's idea) compress card luck
~4x: the gen10-vs-gen7 edge grows from 657 to 783 per 1000 games.

Lifetime training totals (gen1-gen10): **~19.5M full games, ~253M hands,
~8.3B decisions, ~2.3B tricks, ~9.1B cards** (+~42k celebrated redeals at
the analytic 1-in-5,976 rate). Ladder margins narrow as generations absorb
their teachers (63 → 57.5 → 55): the 660k-param reflex MLP is approaching
its ceiling — the next qualitative jump is search + learning (net inside
PIMC), not another rung.

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
- NEXT: search + learning — the champion net as PIMC's rollout/eval policy
  (instinct × look-ahead, the AlphaZero recipe); duel it vs the pure net
- maybe: marathon-trained variant (win_score 2000 in training, not just
  evals) to see if a "grinder" personality emerges
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
