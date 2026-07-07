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

Lessons encoded in the code: league mixing (`--opponent-mix`), per-hand
reward blending, curriculum staging (`--script openings|bid|none`),
BC warm-start (`imitate.py`, order-invariant go-down labels), and
per-decision-type exploration (`--bid-eps`).

## Roadmap

- overnight gen6 continuation → close on the phase-1 PIMC bar (82%)
- unfreeze go-down/trump: net declares trump *intent* before discarding
  (naive sequential discard cloning tops out at 59.5% — the heuristic
  brute-forces the joint discard+trump plan)
- unfreeze bidding last, with competent declarer play priced in
- distill into PIMC's rollout policy (search + learning compound)
- export ONNX → onnxruntime-web → ships as the in-browser AlphaRook brain
