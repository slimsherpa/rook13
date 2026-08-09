# Oracle-contamination kill switch — the dose-response verdict

**Ran overnight 2026-08-08→09 (boxes 1–2). Verdict: `big vein` — the belief
program LIVES, emphatically. One-sided instrument: this prices treasure that
exists, not treasure reachable (injecting truth ≠ redistributing belief
mass; the mortal-reachable share is R2/R3's question).**

Setup: A = Gen25-RC1 with `--contam-a p` (each search world is the TRUE deal
with probability p, else a bel15 sample), B = clean RC1. Identical assembly
otherwise — same reflex, same BidBot, same widow, same discipline. Duplicate
decks, mirror seats, DEV seeds. p=0 control = the belief soak itself (mirror
RC1, 50.0% by construction, ±0 pts/hand).

| dose | pairs | game-win% | pts/hand (paired ±95%) | sweeps | make% A vs B |
|---|---|---|---|---|---|
| p=0 (control) | 1,435 (soak) | 50.0 | 0 (by construction) | — | 65 both |
| p=0.5 | 250 (complete) | **83.6** | **+30.1 ± 2.6** | 169–1 | **80 vs 55** |
| p=1.0 | 104 (stopped early per Riley — fact established) | **79.8** | **+30.8 ± 4.1** | 58–0 | 84 vs 56 (MBP smoke) |

MBP smoke (p=1.0, 2 pairs, x0.25 budgets): 4–0, +347 avg diff — consistent.

## The three readings

1. **The curve is emphatically not flat** — the kill switch does not fire.
   Better imagination has enormous headroom inside the current PIMC
   searcher. No architecture change needed to cash imagination gains.
2. **Scale: ~+30 pts/hand at saturation.** The RC1↔god gap is −38.3 ± 8.2.
   Imagination-shaped loss is therefore on the order of **~3/4 of the whole
   god gap**, and ~4× the entire +8/hand cost of 60% game-win (R6). Even a
   modest mortal-reachable fraction is the campaign.
3. **p=0.5 ≈ p=1.0 (saturating dose curve).** Half-true worlds already
   deliver the full effect: once enough probability mass sits on the truth,
   the select/confirm discipline separates candidates correctly; the rest
   of the world-set is noise it already tolerates. Corollary: a belief net
   does not need to be perfect — it needs to put *meaningful mass near the
   truth*. This is the most hopeful possible shape for belief25-J.

Mechanism note: with the SAME bidding stack on both sides, the contaminated
side made 80% of its contracts vs the clean side's 55% — the auction is
held constant, so the entire edge is play/defense conversion. Also,
contaminated games run short (10.9 hands/game vs 12.2 in the mirror soak) —
blowouts end early via the ±cliffs.

Ops notes: p=1.0 runs ~2.4× slower per game (158 vs 66 s/game) — true worlds
make raw-mean challengers emerge constantly, so the confirm phase fires on
most decisions (override telemetry will show it; the think logs are in the
box dumps). Instrument flag: `--contam-a/-b` in `alpharook/duel.py`, mixture
in `AnytimeRookAgent._world_values`. Never ships (Law 5).

Files: `runs/contam/p10_box1.jsonl` (208 games), `p05_box2.jsonl` (500),
logs beside them. Fleet: p=0.25 arm cancelled per Riley 2026-08-09 morning —
the question is answered; boxes pivot to auction work.
