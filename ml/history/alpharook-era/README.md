# The AlphaRook era — the mortal ceiling, measured (2026-08-01 → 08-05)

Five days, ~$15 of rented CPU, one C port, and eleven honest negatives
on the way to one confirmed positive. This folder holds the data; the
full recipes and verdicts live in [../../GEN24-PLAN.md](../../GEN24-PLAN.md)
(the campaign log) and [../../GENERATIONS.md](../../GENERATIONS.md)
(the ledger chapter). Riley's artifact tells the story:
https://claude.ai/code/artifact/02fbc294-0722-40b9-a21b-4737ba036cd1

## The headline

**MortalRook beats Cosmo (gen21×belief×t0, production) at card play:
+1.68 ± 0.80 pts/hand, pooled over 83,604 duplicate-deck hands** —
the first causally confirmed card-play improvement over the champion
in project history, after 11 failed attacks across three eras.

What MortalRook is: the champion's own reflex incumbent + exact-solver
overrides — sample K observation-consistent worlds from the gen15
belief posterior, EXACT-solve every candidate card in each (C solver),
convert to family hand currency (set = −bid), and override the reflex
only when fresh evaluation worlds confirm the challenger by ≥2 pts
(the split-sample discipline; without it, raw argmax LOSES 2-8 —
gen11's winner's-curse law, re-proven).

## The final K-ladder (duplicate decks, family format, identical bids)

| K | games | hands | pts/hand ± 95% | win% | make% | decl pts | def pts |
|---|---|---|---|---|---|---|---|
| 48 | 3,000 | 36,613 | **+1.36 ± 1.21** ✅ | 51.8 | 65v64 | 100.8v100.1 | 19.9v19.2 |
| 96 | 2,360 | 29,295 | **+2.07 ± 1.36** ✅ | 51.9 | 65v64 | 101.1v99.9 | 20.1v18.9 |
| 192 | 1,166 | 13,937 | +1.78 ± 1.96 | 52.7 | 66v64 | 101.0v100.2 | 19.8v19.0 |
| 384 | 238 | 2,903 | +2.16 ± 4.28 | 53.8 | 67v65 | 101.9v101.0 | 19.0v18.1 |
| 768 | 72 | 856 | −1.59 ± 7.85 | 51.4 | (noise) | | |

**The curve's verdict at this precision: the edge arrives at K48 and
does NOT measurably grow with more compute in real sequential play.**
The flashcard probes (8.6k, split-sample) had shown per-DECISION gains
rising +1.7→+3.9 from K12→K96 with no knee — but per-decision gains
under perfect-continuation assumptions do not compound into
proportional per-hand gains in real play. All arms K48–K384 are
statistically compatible with a flat ~+1.5–2 pts/hand. (A ±1-per-arm
campaign to resolve K96-vs-K48 was underway when Riley called it —
~54k hands/arm needed; the wrap happened at ~84k total.)

Role split (Riley's cliff-free view): the edge is small and symmetric —
~+0.7–1.2 raw captured points in BOTH roles per hand, matching the
scoreboard delta. Steady card economy, not dramatic contract rescues.

## The laws this era added to the ledger

1. **Reflex saturation is real.** Three specialist designs (hindsight
   labels, belief-world labels, champion-trunk graft) + the flywheel
   test all failed to move card play — the champion's pattern knowledge
   is at its data ceiling; the residual skill is per-state COMPUTATION.
2. **The winner's curse is the tax on imagination.** Raw argmax over
   sampled worlds loses OUTRIGHT even with a perfect evaluator
   (paired 2-8). Split-sample confirm (choose on selection worlds,
   verify on fresh worlds) converts the same computation into a
   confirmed edge. Discipline is not optional garnish; it IS the edge.
3. **Per-decision gains ≠ per-hand gains.** Flashcard probes are the
   map, sequential duels are the territory; the map overstated the
   compounding by ~3-5×.
4. **Interpreted → compiled is worth 58-66×** (rook/csolver.c, parity-
   gated on both platforms). The opening LEAD is the cost wall: ~8×
   any other trick-0 decision, ~1000× late tricks (think_time.log).
   Production design: budget-shaped K (8s at 8 cores ≈ K50-64 on the
   lead, K200+ on follows, ~unlimited late).
5. Ops scars: zsh doesn't word-split unquoted vars; pkill matches its
   own ssh session without the [b]racket trick; never rsync a .so
   cross-platform (wrapper now rebuilds on bad ELF); a silent solver
   fallback needs a loud log line; spawn workers evade parent-pattern
   kills — kill by venv path.

## Files

- `duels/` — every duel dump (JSONL, one game/line incl. per-hand
  history) + final progress logs + `dashboard_final.html` (the live
  board's last frame; regenerate any time with
  `scripts/alpharook_dash.py`).
- `probes/` — the C-era flashcard shards (K192/K384) + fleet probe
  shards (K12–K96 arms).
- `probes_local.tgz` — the MBP probe arms (the original curve).
- `bidbot_corpus.tgz` — the BidBot calibration corpus (dealt-9 +
  auction + outcome + par per hand, ~1.5k hands) — the B-track's
  seed data, parked.
- `think_time.log` — per-decision latency distributions by K.
- `mrook_telemetry.log` — override rates by trick (fires 1.5×/hand,
  26% of opening decisions → 3% by trick 7).
- Large regenerable corpora (cardgym 1.7G, widowgym 1.5G, belief24
  525M) stay in `runs/gen24/` (gitignored); regenerate via their
  modules if ever needed — every generator is deterministic by seed.

## How to resume (if the itch returns)

- The player: `alpharook/mortalgod.py::MortalRookAgent` (K, eval
  worlds, tau all dialable); duel flags `--mrook-a K --belief-a
  models/gen15.pt`. The C solver builds itself on import.
- The open questions, priced: K96-vs-K48 needs ~54k hands/arm for ±1
  (~2 box-days each with the C solver). The K768 tail needs ~40
  box-days — measure only after a reason exists.
- The production path (designed, unbuilt): budget-shaped K in the
  service behind an env var, ~$0.01-0.15/game; then the mimic loop to
  distill MortalRook into a browser-shippable reflex (the only proven
  "mash": teacher corpus → warm-start clone → gauntlet).
- Fleet recipe: `scratchpad bootstrap.sh` pattern is reproduced in
  GEN24-PLAN.md — venv + torch-cpu + build-essential + rsync code +
  rm stale .so; ~10 min/box.
