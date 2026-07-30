# The gen23 era — from corpus to crown to ceiling (2026-07-27 → 07-30)

Three days, three results: the strongest reflex ever built, a confirmed
map of the whole ladder, and the first honest measurement of Rook's
skill ceiling. This folder holds the data; GENERATIONS.md holds the
recipes; the artifacts hold the story:

- "The 48-Hour Match" — the teacher corpus deep-dive
- "gen23 runs the gauntlet" — 18 matchups, every generation
- "AlphaGodRook runs the gauntlet" — the ceiling, measured

## Files

- `gauntlet_report.json` — per-matchup stat packs, gen23 vs everything
  (win%, score/bid distributions, make-vs-set by bid, sweeps)
- `god_report.json` — same packs, AlphaGodRook vs everything
- `raw-dumps.tgz` — every duel dump behind both reports (one JSON line
  per game incl. per-hand history; ~14k gen23 games + ~950 god games)
- `gauntlet_stats.py`, `build_*_artifact.py` — dumps → packs → artifacts

## The three headline tables

### 1. How gen23 was made (the mimic loop, executed)

| step | result |
|---|---|
| teacher selection | t0 (K24 search from the opening lead) = 78.5% vs gen21, n=10,046, ±1.0pp — t3/t1 close out at ~75% |
| corpus | 48h, 6 machines, ~$50: 58,482 games / 2.46M hands / ~60M teacher rows / 4.3M needles, every game replay-verified, 0 losses |
| training | warm-start from gen21, lr 5e-5, override×4; 120k steps ≈ 61M rows in 4.5h on 8 CPU cores |
| the curve | needle-match 1.1%→20.9% in the FIRST 2k steps, flat after; val loss falls the whole run. The leap is immediate; the rest is calibration — and the calibration is the player |
| candidate | quiz-best (step 2k) = 49.6% parity; run-end latest = the champion. The quiz nominates, the duel crowns |

### 2. gen23 vs the ladder (fresh seeds, duplicate decks)

| opponent | sprint | marathon |
|---|---|---|
| teacher (gen21+t0) | 39.6% | 31.0% |
| gen21 (donor) | 52.2–53.0% | 56.3–58.1% (replicated ×2) |
| gen19 · Cosmo (search) | 51.2% | 55.5% |
| gen16 · Cougar (search) | 53.2% | 57.5% |
| gen13 · Puma | 57.1% | 66.2% |
| gen11 · Cub (search) | 58.0% | 67.0% |
| gen10 · Bobcat | 60.7% | 70.0% |
| gen9 · Kitten | 61.8% | 72.8% |
| gen8 · Stomper | 62.1% | 72.2% |

Perfect monotone staircase; marathon edge > sprint edge in all 18 arms
(small edges compound); a pure reflex at parity-or-better with every
production search stack, losing only to its own teacher.

### 3. AlphaGodRook vs everything (exact-solver play, gen21 bids)

| opponent | god win% (sprint) | pts/hand | make% god/opp |
|---|---|---|---|
| teacher | 92.0 (n=100) | +38.2 | 77 / 48 |
| gen23 | 91.0 (n=100) | +40.1 | 80 / 49 |
| gen21 | 89.0 (n=100) | +36.9 | 78 / 51 |
| Cosmo | 93.0 (n=100) | +43.6 | 80 / 48 |
| Cougar | 95.0 (n=40) | +44.7 | 76 / 44 |
| Puma | 95.8 (n=48) | +44.6 | 83 / 49 |
| Cub | 91.0 (n=100) | +41.5 | 82 / 53 |
| Bobcat | 97.1 (n=70) | +50.9 | 86 / 48 |
| Kitten | 92.0 (n=100) | +46.5 | 80 / 49 |
| Stomper | 97.9 (n=96) | +53.1 | 85 / 45 |
| gen21 marathon | 100.0 (n=22) | +49.0 | 84 / 44 |
| gen23 marathon | 100.0 (n=10) | +43.8 | 91 / 51 |

**Across 460 duplicate-deck pairs, ten opponents: zero pairs swept
against god.** Not one. Not even by the teacher.

## What this era taught (the compressed laws)

1. **The mimic loop is the reflex channel.** Twice now (gen21, gen23):
   verify a stronger teacher by marathon duel, record raw replay-checked
   corpus, warm-start behavior-clone, screen candidates by duel. Eight
   DMC attacks failed where two clones rung the ladder.
2. **The leap is immediate; the calibration is the player.** Warm-started
   students absorb the teacher's learnable delta in ~1M rows; the
   argmax quiz then flatlines while val loss keeps falling — and the
   long calibration tail is what actually wins duels. Never bank on the
   quiz's early peak (step-2k "best" was pure parity).
3. **Hidden information, not deal luck, is the wall in Rook** (the
   AlphaGodRook revision). Luck floors cap *information-equal* players:
   the teacher only wins 63.7% of sprints vs gen21. But omniscience wins
   89–98% of sprints against everything — a +40/120 per-hand edge
   steamrolls short-game variance. Riley's "99% vs gen8" was correct
   *for the ceiling*; every mortal player sits far below it, which
   means the space above the teacher is still enormous.
4. **Measurement doubles as production.** The 78.5% significance run and
   the 60M-row training corpus were the same games. Design duels to dump.
5. **Per-hand stats sharpen ~10× faster than game win%.** pts/hand and
   make-rate-at-same-bid made 40-game god arms readable; game win%
   alone would have needed thousands.
6. Operational scar tissue: resume-safe streams (crash = replayed seed
   space at full search cost); pkill'd duel parents orphan spawn
   workers; write-path field filters silently eat new record fields
   (audit the artifact, not the code); macOS launchd can't read
   ~/Documents (TCC) and crontab hangs headless; the :8080 board server
   dies on reboot without an @reboot entry; Hetzner bills stopped
   servers — delete, don't stop.

## Where the irreplaceable data lives

- **The 60M-row teacher corpus** (raw, re-millable, ~2.5GB):
  hub `runs/t0shards/` + partial copies on boxes 2-5 and the MBP.
  **PULL TO LOCAL BEFORE DELETING THE FLEET** — it can train every
  future student and is the single most expensive artifact of the era.
- Gauntlet + god dumps: this folder (`raw-dumps.tgz`) — safe.
- Checkpoints: `models/gen23-cand1.pt` (repo + all machines).
