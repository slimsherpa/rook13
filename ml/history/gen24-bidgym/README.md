# gen24 — THE BID GYM (opened 2026-07-30)

> Rook is classically a game of BIDDING, not playing. — Riley

## Why this gym exists

The evidence converged from four directions (see GENERATIONS.md):

1. The par oracle says ~28% of contracts bought are unmakeable at perfect
   play — the loss was locked in at the auction.
2. gen7's lesson: learned bidding beat family bidding 63/37 on identical
   cards by winning more contracts at LOWER bids.
3. Even AlphaGodRook only makes ~80% of mortal bids — god can't play his
   way out of a bad contract.
4. The blunder detector now generates live family evidence with every 🎯
   verdict ("the 100 bid was the blunder — perfect play only takes ~85").

## The design bet: interpretable genes, not neural weights

Every previous gym evolved neural nets and mostly banked mirages (laws
2, 5, 6). This gym inverts the approach, inspired by poker's solver era
(Nash equilibria, Bayes, Nate Silver's *On the Edge*): the strategy space
is **15 named genes** (`alpharook/bidgenes.py`), so when a population
converges we don't interrogate a black box — we *read the genome*.

- **Card play never varies.** Every seat in every game — card play,
  go-down, trump — is gen23 reflex (`models/gen23-cand1.pt`, the reflex
  distillation of gen21+t0). Fitness differences are pure bidding.
- **Games are the family format, -250/+500.** The format that punishes
  bad bidding hardest: for most of the game one set is a cliff.
- **At default genes the genome IS the family calibrated bidder** —
  `tests/test_bidgenes.py` asserts exact match with
  `rook.bots.choose_bid("basic")` on thousands of fuzzed auction states.
  Every evolved delta is therefore a legible delta from the family's own
  calibration.

### The genes

| gene | default | what it answers |
|---|---|---|
| `base`, `per_trick` | 83, 6 | the aggression anchor (family: 86 − cushion 3) |
| `min_tricks` | 0.8 | junk filter |
| `widow_hope` | 0 | phantom widow tricks |
| `partner_boost` / `partner_drag` | 8 / 4 | table talk |
| `overbid_margin` | 15 | raise your own partner? |
| `war_stretch` | 0 | stretch past comfort vs enemy high bid |
| `jump_gap` / `jump_reserve` / `jump_cap` | 20 / 5 / 105 | crawl +5s vs jump bids ("bid slow and up" vs "take it fast") |
| `deficit_slope` | 0 | willingness per point behind |
| `desperation` | 0 | stretch as the enemy nears +500 |
| `protection` | 0 | ± caution as WE near +500 (negative = closer instinct) |
| `cliff_fear` | 0 | a set here ends the game at -250 |

The last four are the poker genes. The family bidder is score-blind;
whether score-aware bidding wins the -250/+500 format is the experiment.

## The cities

One city = one process (`alpharook/bidcity.py`), 10 evolving genomes +
2 immortal anchors (**family** = default genome, **gen23** = the net's own
neural bidding). Every season: full round-robin, every matchup on the SAME
salted deck-pairs with seats swapped (duplicate decks — deal luck cancels),
then cull the bottom, breed from the top (crossover + Gaussian mutation).
Population play is replicator dynamics: the league drifts toward the Nash
equilibrium of the bidding game (holding play fixed), and the anchors are
the meter stick.

| city | culture | founders |
|---|---|---|
| provo | balanced (σ×1.0, p=.35, cull 3) | family + jitter |
| orem | hot explorer (σ×2.2, p=.55, cull 4) | family + jitter |
| logan | **cold start** (σ×1.2, p=.40) | random genomes — can bidding be rediscovered from scratch? |
| moab | conservative control (σ×0.5, p=.25, cull 2) | family + jitter |

Bidders are named after poker players (name ≠ brain, as always).

## Instruments

- `alpharook.bidcup` — the world cup: city champions + anchors,
  fresh salted decks, 40 pairs/matchup. In-city standings are weather;
  the cup is climate (law 2: nothing counts under 100+ pairs).
- `alpharook.bidprobe` — **the curiosity instrument**: a stratified
  60-hand panel × 7 auction scenarios × 9 score states, every bot's exact
  bid recorded. Same hand, different situation — what do they bid?
- `scripts/gen24_status.py` — the 10am/10pm check-in: standings, champion
  gene deltas, anchor trajectory, behind/ahead/tied bidding splits.
- Every 10th season each city dumps raw per-hand auction rows
  (`hands_sNNNN.jsonl`) for the artifact.

## Operations (all local — the Hetzner fleet stays retired)

```bash
ml/scripts/gen24_launch.sh        # start/resume all four cities
pkill -f alpharook.bidcity        # stop
~/torch-env/bin/python scripts/gen24_status.py            # check in
~/torch-env/bin/python -m alpharook.bidcup  --pairs 40    # championship
~/torch-env/bin/python -m alpharook.bidprobe              # behavioral X-ray
```

Throughput on the MBP: ~0.1 s/game/city → a 528-game season in <1 min →
~60+ seasons/city/hour. State (`runs/gen24/<city>/state.json`) is saved
atomically every season; relaunching resumes.

## House rules carried over from the ledger

- Law 2: no result is believed under 100+ pairs (that's what the cup is
  for); in-league fitness is allowed to be noisy because selection only
  has to be right on average.
- Read per-hand stats (made% at same avg bid) before game win%.
- Anchors never reproduce, never mutate, never die.
