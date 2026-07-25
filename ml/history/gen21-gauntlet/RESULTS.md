# gen21-cand1 gauntlet — 2026-07-25

Riley's wringer for the first mimic champion candidate
(`models/gen21-cand1.pt` = mimic1-b step-50k: gen13 warm-start via
`surgery.graft_v4`, action-space BC of the champion stack, 691k params,
one forward pass, no search). Opponents at PRODUCTION configs: Puma =
gen13 reflex; Cougar = gen16 stack (K8, prior 2, t≥4, belief 0.5);
Cosmo = gen19 stack (K8, prior 2, t≥3, belief 0.5). 1,250 duplicate-deck
pairs per matchup (2,500 games), seats swapped; sprints −250/500,
marathons −2500/5000 (~180 hands/game). Ties are structurally impossible.
Raw per-game dumps in this directory (`*.jsonl.gz`, `duel.py --dump`
format; `-hh` files add per-hand records). Reproduce the table with
`python -m alpharook.gauntlet_report` and the luck/skill split with
`python -m alpharook.hand_pair_report`.

## The table

```
matchup                          win%          avg scorecard    W-L-T        hands  bid    took   made%  set%   opp-made%  avg diff
sprint   vs Puma (gen13)         54.7% ±2.0%   342 to 300       1367-1133-0  12.4   101.2  50.8%  63.4%  36.6%  61.5%      +42.0
sprint   vs Cougar (gen16 prod)  49.1% ±2.0%   320 to 330       1227-1273-0  12.5   101.3  51.4%  62.2%  37.8%  63.4%       -9.7
sprint   vs Cosmo (gen19 prod)   48.8% ±2.0%   311 to 330       1221-1279-0  12.4   101.3  51.6%  61.5%  38.5%  63.4%      -18.4
sprint   vs itself               50.0% ±2.0%   323 to 323       1250-1250-0  12.7   101.5  50.0%  62.1%  37.9%  62.1%       +0.0
marathon vs Puma (gen13)         68.9% ±1.8%   4662 to 3949     1722-778-0   179.9  102.0  49.5%  61.9%  38.1%  59.4%     +712.8
marathon vs Cougar (gen16 prod)  44.5% ±2.4%   4218 to 4466     762-952-0    182.0  101.9  52.2%  59.8%  40.2%  61.4%     -247.6
marathon vs Cosmo (gen19 prod)   46.5% ±3.0%   4216 to 4440     478-550-0    181.1  101.9  52.0%  59.9%  40.1%  61.5%     -223.9
marathon vs itself               50.0% ±2.0%   4339 to 4339     1250-1250-0  184.2  102.2  50.0%  60.4%  39.6%  60.4%       +0.0
```

Search-marathon rows were stopped early once conclusive (Cougar 857
pairs, Cosmo 514 pairs); every other row is the full 1,250. The two
self-rows landing at exactly 50.0% with identical scorecards are the
harness's fairness proof (mirror games are deterministic).

## Riley's luck-vs-skill hand decomposition

Hand k of both games in a pair is the same deal held by opposite sides
("won the hand" = larger score delta incl. set penalties):

```
                        sprint (12,465 hand-pairs)   marathon (206,103 hand-pairs)
cards decided                 73.7%                        74.3%
gen21 won no matter what      14.0%                        14.0%
opponent won no matter what   12.2%                        11.8%
skill hands → gen21           53.4% ±1.7%                  54.3% ±0.4%
avg swing when gen21 won both +114 pts                     +116 pts
```

~74% of Rook hands are decided by the cards regardless of who holds
them. In the ~26% where the player matters, gen21 takes ~54% — a
per-hand edge under 1pp that compounds to 55% over 12-hand sprints and
69% over 180-hand marathons. Sprint and marathon decompositions agree to
within a point: measured fact, not estimate.

## Verdict

- **gen21 is decisively past gen13** (the reflex plateau of 8 failed
  attempts is broken) and **matches the production search stacks at
  sprint length with zero think-time**.
- **The stacks keep a real edge in marathons** (~44-46%): their search
  advantage compounds in the grind exactly like gen21's does over Puma.
  Cosmo (gen19 stack) remains the strongest complete bot.
- Path forward: gen21 × search × belief should exceed the current
  champion stack (its reflex alone is Cosmo-parity) → that composite is
  the gen22 teacher. Before shipping gen21 anywhere: composite exam,
  guardsim endgame-bid battery, role audit, TS ports (engine bid_history,
  encoder v4).
- Context: teacher ceiling (gen13+belief+K24 t≥3 vs gen13) = 62.6%/1000.
  Sibling replication: mimic1-c (widen×2 warm start) = 54.9%/1000 at the
  same step with a better quiz (92.7% bid / 28.3% override match) —
  the graduation replicates across architectures.
