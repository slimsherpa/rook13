# AlphaRook

The project to build a superhuman Rook13 player. Code lives in
`src/lib/alpharook/`; nothing here ever touches Firestore — all search and
training happens in memory, and only the finished brain ships to the browser.

## Rule integrity (non-negotiable)

Agents never see a `GameDoc`. They see an `Observation`
(`observation.ts`) — exactly what a human in that chair knows: their own
cards, all face-up plays, the bidding, and the go-down only if they took the
bid. `alpharook.test.ts` proves no hidden card can leak, across many game
states, for every seat. Everything the agent "knows" beyond that is inference
from legal information: who showed void in what, how many cards everyone
holds, which cards are still unaccounted for.

## Phase 1 — Search (SHIPPED)

**PIMC (Perfect-Information Monte Carlo)**, the approach behind bridge's GIB
and championship Skat bots:

1. `determinize.ts` samples complete "worlds" consistent with the
   observation — unseen cards dealt to opponents/go-down, respecting hand
   sizes and known voids.
2. `rollout.ts` plays each world to the end of the hand with the heuristic
   bots, on a fast mutable state (validated move-for-move against the real
   engine).
3. `pimc.ts` scores every legal card across K worlds and plays the best.

Measured (bench, 120 games, sides swapped, heuristic bidding both teams):

| Config | Game wins vs Standard | Speed |
|---|---|---|
| K=10 | 70.0% (±5.6) | 1.7 ms/decision |
| K=25 | 81.7% (±4.6), +9.5 pts/hand | 4.2 ms/decision |

Fast enough to run live in the browser. `agent.ts` exposes
`nextAgentAction()`, a drop-in for `nextBotAction()` that gives seats with
`botStyle: 'alpharook'` the search brain; the lobby offers it as
**AlphaRook**, and it is the default style for auto-filled bot seats.

## Phase 2 — Search bidding (SHIPPED)

`choosePIMCBid()` prices every auction decision by simulation: for each
candidate (pass, the minimum raise, and a ladder of jumps at +10/+20/+30),
sample K=20 worlds and play the *entire* rest of the hand out — remaining
auction (heuristic opponents), widow, go-down, all nine tricks — then take
the best average hand score. `playOutHand()` in rollout.ts drives the
auction phases on the fast path, validated hand-for-hand against the real
engine. ~12 ms per bid decision.

Results:

- Full AlphaRook (bid + play search) vs Standard: **~81% game wins** pooled
  over 160 games.
- An all-AlphaRook table **rediscovers the family meta on its own**: winning
  bids mode 100 (36%), median 100, 95 ≈ 29%, cheap takes at 65–80 under 3%,
  115/120 rare, sets ≈ 39%. Nobody told the search "100 is typical."
- Robustness: deep-endgame world sampling can squeeze the greedy sampler
  into a corner (all remaining seats void in the suits that remain); a
  backtracking solver now guarantees a consistent world whenever one exists.

## Phase 2.5 — Search leftovers (next)

- **Go-down/trump by rollout**: score candidate discards by simulated hands
  rather than the static estimate (the last heuristic decisions left).
- **Smarter world sampling**: weight determinizations by the auction (a seat
  that bid 100 holds trump length; a seat that passed doesn't) — today's
  sampling is uniform.
- Raise K adaptively (cheap early tricks, deep late tricks).

## Phase 3 — Learning (the real AlphaRook)

DouZero-style Deep Monte Carlo, the proven recipe for card games this size:

1. **Data**: self-play on the MacBook — the engine does roughly 25k
   hands/min/core; 8 workers ≈ 10M+ hands/hour. Trajectories written to
   local files (never Firebase).
2. **Model**: a small policy/value network over the Observation encoding
   (hand, plays, bids, voids, counts). Train in PyTorch (Apple-silicon MPS
   first; rent a GPU ~$0.50/hr only if training stalls).
3. **Ladder**: gen0 = `random` (floor) and `basic`/PIMC (baselines). Every
   generation must beat the previous in the head-to-head harness (600 games,
   sides swapped) to be promoted. Elo tracked per generation.
4. **Ship**: export to ONNX, run inference in the browser via
   onnxruntime-web (~1–5 MB model). The learned policy can also replace the
   rollout policy inside PIMC — search + learning compound.

## Benchmarks to keep honest

- `random` — the floor (any legal move).
- `basic` — the tuned heuristic family bot.
- PIMC K=25 — phase-1 search, 81.7% vs basic.
- Humans — the JAY CUP is the real eval set.
