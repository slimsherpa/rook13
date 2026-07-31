# BidBrain — the best-response bidder (gen24, Act IV)

*Opened 2026-07-31, after the 2,000-game verdict put the pairs league at
exact parity (50.8% ± 1.1) and closed the first three attacker classes.*

## The thesis

gen23's auction is a **frozen, deterministic, known policy**. Frozen
policies are not equilibria — they have a best response, guaranteed to
exist. Three attacks failed to find it for identifiable reasons:

| attacker | result | why it capped |
|---|---|---|
| gene cities (formula evolution) | ~35% | blind hand evaluator (`estimate_tricks`); position-deaf |
| AlphaBid oracle (worlds + rollouts) | 47–49% | winner's curse: EV gaps ≈ sampling noise at laptop K |
| pairs league (Q-value nudges) | 50.8% ± 1.1 | modulations too timid to leave the crawl basin; position-deaf; no defensive-value concept |

BidBrain removes every identified cap at once: **learn
P(win the game | situation, candidate bid) directly from millions of
real finished −250/+500 games against the frozen house, then bid the
argmax.** No formula. No world-sampling at decision time (the net
marginalizes hidden hands the way experience does — the curse cannot
occur structurally). No nudging — the net owns the decision.

This is Riley's step-five made literal: *"do it thousands of times and
get a feel for what exists."*

## The five factors (Riley's human-bidding spec → feature blocks)

The feature vector (`bidbrain.featurize`, 95 dims) is organized as five
blocks in the order a human thinks, and this table is the contract —
any future change to the features updates this table:

**1. THE SCORECARD** *("am I ahead, am I behind, what's going on")* —
raw scores, difference, the fitted P(win | score) prior (`winprob24`,
fitted on the gene cities' 1.36M banked score-states), cliff flags
(≤ −130: one set from death), closing flags (≥ 350), hand number.
9 dims.

**2. POSITION** *("who dealt? bidding first sets the tone; the opener
leads trick 1")* — voice-order one-hot (am I 1st/2nd/3rd/4th to speak),
plus the tempo triad: I lead trick 1 / partner leads / opponent leads.
7 dims. **No previous attacker had any of this.**

**3. MY HAND** *("good? bad? bluffable? a setting hand? a slam
dunk?")* — all 40 card bits raw so the net builds its own evaluator
(the wall every formula attacker died on), per-suit counts / points /
top honor, and `estimate_tricks` demoted from oracle to hint. 53 dims.
Defensive value is not a hand-crafted feature — with raw cards plus
outcomes, "great setting hand" is learnable as a pattern.

**4. THE TABLE TALK** *("what have their bids told me? what about my
partner?")* — per-relative-seat record (has bid, max bid, FIRST bid —
the signal channel — passed), standing high bid and floor, who holds
the contract (me / partner / opponent / nobody), auction length,
must-bid flag. 20 dims.

**5. THE WAGER** *("set my bid and hope")* — the candidate itself:
pass flag, level, distance over floor, jump flag,
**would-going-set-end-the-game** (the −250 cliff, priced per bid), and
**could-making-close-the-game**. 6 dims. Bluffing, sandbagging, and
hero jumps are not special-cased: they are points on the learned curve
that the argmax selects exactly when the data says they win.

## The data (bidbrain_data.py)

- Every game: all four seats **play** with frozen gen23 (cards,
  go-down, trump never vary — the gym's constitution).
- One team per game is the **explorer**: each bid decision is, with
  ε = 0.3, a uniformly random legal bid — including PASS, wild jumps,
  and doomed 105s. **Exploration is the new ingredient**: an
  argmax-only corpus cannot answer "what if I had bluffed?" because
  the counterfactual never occurs in it.
- Both teams' rows are logged (house argmax rows are free signal),
  each tagged `was_random` and labeled with its team's final outcome.
- Rows are stored RAW (cards, full bid sequence, dealer, scores) so
  features can evolve without regenerating games.
- Throughput: ~7 games/s/worker × 8 workers ≈ 700k games / ~35M rows
  per 4-hour soak on the MBP.

## The model & training

MLP 95 → 256 → 256 → 128 → 1 (~100k params), BCE on game outcome,
newest shards held out for validation. This is Monte-Carlo Q-evaluation
of the near-house behavior policy; argmax over candidates is one-step
policy improvement against the house — the textbook best-response move.

## The gates (law 2, as extended 2026-07-31)

- Nothing is believed under **1,000 pairs (2,000 games)**, duplicate
  decks, seats swapped, **family format only** (−250/+500; marathons
  are explicitly ruled out — "marathons never matter in a bidding
  game").
- The gate opponent is the full gen23 house (its own bids, its own
  play). Pass = > 50% with the CI clear of parity.
- If the gate passes: BidBrain becomes the pairs league's base policy
  (conventions layer on top), and a candidate for distillation into
  the production stack.

## The v1 result and the structural diagnosis (2026-07-31, hour 5)

The 6-hour arc: v0 (unweighted) = **2%** — the confounding disease, it
learned "bidding 120 is what winners do" from house correlation. v0.5
(causal rows ×20, 30 shards) = **27%**. v1 (152k games) = **32.5%**
peek. Each fix was found by a cheap 100-pair peek, never by burning the
soak.

What the flattening curve says: single-game WIN/LOSS labels on
one-step deviations resolve LARGE causal effects instantly (the
120-bomb costs ~30pp — learned in the first epoch) but cannot resolve
the 1-2pp effects that decide crawl-vs-pass at ordinary floors — and
crawl-vs-pass at 70-95 is exactly where the house currently collects
1,900 contracts to our 370. More single-label data helps at sqrt speed;
we need a variance kill, not a bigger pile.

## Corpus v3 — TWIN GAMES (designed, next session)

Common-random-numbers counterfactuals: for a sampled decision state,
play the SAME deal twice — once pure house baseline, once with exactly
one deviation — deterministic policies + same deck mean the two games
share every card. The label becomes the OUTCOME DIFFERENCE (-1/0/+1):
the pure causal effect of that one bid in that world, all common
variance cancelled. Better still, one baseline serves every candidate:
one sampled state yields the complete local advantage curve
A(s, a) for all ~12 legal bids at ~7 game-equivalents of compute.
States where the bid doesn't matter label 0 ("relax, it's a wash") —
which is itself the most human bidding lesson in the whole project.
Train on advantages, bid argmax(A). Expected yield: ~50k full curves
(600k near-noiseless rows) per overnight soak.

1. Val logloss barely under 0.693 → the label is too noisy per row →
   more corpus, or train on hand-level score deltas as auxiliary target.
2. Argmax collapses to always-pass or always-max → check ε rows made it
   into training; check class balance by candidate level.
3. Beats house on explorer-style tables but not pure house → behavior
   mismatch; retrain with ε annealed lower or add pure-house games.
