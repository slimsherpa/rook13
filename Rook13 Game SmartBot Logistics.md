# Rook13 SmartBot Logistics

How the bots think. The implementation lives in `src/lib/game/bots.ts`; the
behavior tests (including the statistical bidding calibration) live in
`src/lib/game/bots.test.ts`.

## The four personalities

Every seat's bot has a `BotStyle`, and each style maps to a row of knobs in
`PERSONALITIES`:

| Knob | Easy (`random`) | Standard (`basic`) | Aggressive | Cautious |
|---|---|---|---|---|
| Bid cushion (pts under the estimate) | — | 3 | 0 | 8 |
| Min tricks to bid at all | — | 1.0 | 0.5 | 1.5 |
| Widow optimism (tricks) | — | 0 | +0.5 | −0.3 |
| Bidding-war stretch (pts) | — | 0 | +5 | 0 |
| Will outbid partner (live auction) | — | needs +15 pt edge | needs +10 pt edge | never |
| Pulls trump on defense | — | no | yes | no |
| Hunts point-less tricks | — | no | yes | no |
| Ruffs in early without points showing | — | yes | yes | no |
| Feeds counters on partner's *likely* wins | — | yes | yes | yes |
| Ruffs in early when the lead suit has count left | — | yes | yes | yes |
| Banks loose counters in the go-down | — | yes | yes | yes |

Easy ignores all of it and plays any legal move — it exists as the floor to
measure future bots (AlphaRook) against.

## Bidding

1. **Hand evaluation.** `estimateTricks()` scores the 9-card hand with its
   longest suit as trump: trump honors (14/13/12/11), side bosses, short side
   suits it can ruff (each ruff reserves a spare trump) — and above all
   **trump length**: the 4th trump adds 0.4 tricks, the 5th and beyond add
   0.9 each. Five trump is SUPER good, per the family, and the sims agree.
2. **Tricks → points.** `TRICK_TO_POINTS` (base 87, +6/trick) converts the
   estimate into the most the bot will pay. Fitted reality (over ~2,000
   simulated hands with randomized contracts) is ≈ 71 + 8.5 × tricks — the
   big intercept is real: trump choice, the widow, and an average partner are
   a big head start. The willingness line is deliberately flatter and
   anchored near 100: at this family's table everyone knows a takeable hand
   is worth about 100 and hand strength only nudges the price. That
   compression is what makes 100 the clear typical winning bid, and it
   carries the same winner's-curse set rate the human meta does.
3. **Auction manners.**
   - Creep in +5 steps while feeling out the table, but **jump-bid** with a
     hand far above the going rate: someone opens 70, the next player with a
     real hand says 100. Statements top out at 105; bids past that only
     happen when a genuine war forces them one step at a time. About half of
     all raises end up being jumps.
   - **Never bid when your partner holds the high bid and both opponents
     have passed.** The contract is already yours; bidding only raises it.
     (This was family complaint #2, and it is a hard rule for every
     personality.)
   - In a live auction where partner holds the high bid, only take it away
     with a clearly stronger hand (see the per-personality margin). Cautious
     never does.
   - A partner who bid adds +8 pts to the estimate (their tricks count too);
     a partner who passed subtracts 4. The boost never applies toward
     outbidding that same partner.
   - Forced to bid (three passes)? Take the 65 and make the best of it.

### Calibrated outcome (matches the family meta)

Measured over ~1,700 bot-vs-bot hands per lineup:

- All-Standard table: median 100; **95/100 are the twin peaks (≈ 32%/31%)**
  with 105 right behind (≈ 18%), 90 ≈ 13% and 110 ≈ 2% rare, 85/115 very
  rare, 80/120 and cheap takes at 65–75 essentially never. Mean ≈ 98, set
  rate ≈ 33%, and ~47% of raises are jump bids.
- Mixed table (with an Aggressive seat): mode 100, 105 ≈ 26%, set rate ≈ 41%
  — Aggressive buys more hands and sets more, which is the point.

The ~33% set rate is the honest price of a 100-centered meta at current play
strength (per-hand luck spread ≈ 25 points); go-down banking and the length
re-weighting clawed it back from ~45%. Knob: `TRICK_TO_POINTS.base` shifts
the whole distribution (±1 ≈ ±1 bid point, ≈ ∓1.5% set rate). Further
set-rate gains must come from better card play (AlphaRook) — reality rises,
the anchor stays.

## Widow, go-down, and trump

Two family laws are hard-coded: **the longest suit is always trump**, and
**trump never goes in the go-down** (unless the hand physically forces it).
The bid winner names its longest suit, then brute-forces every legal 4-card
go-down from the non-trump cards and keeps
the discard that leaves the strongest 9 cards — which naturally hoards trump,
empties short side suits to create ruffing voids, and keeps side bosses. It
also treats the go-down as a **bank**: loose counters (a blank 10, an
unguarded 5) go down rather than into enemy hands, since the declaring team
usually wins the last trick and collects them. A/B: banking at −0.06 won
58–60% of games vs. avoiding burial, and cut the declarer's own set rate by
~5 points; banking harder (−0.10 and beyond) loses — it starts sacrificing
real hand strength for points that get lost a third of the time. The trump
declaration recomputes the same objective on the kept 9 so the named suit
always matches what the discard was shaped around.

## Trick play

Shared brain for the three heuristic styles, with personality flags where
noted. Bots remember only what a human could: completed tricks, the current
trick, and their own hand.

- **Leading:** pull trump only while it's winning (boss trump in hand, or
  clear length dominance) and stop once trump is dead; otherwise cash side
  bosses from long suits or lead low from length without gifting counters.
  Defenders don't lead trump (Aggressive does).
- **Following:** feed counters when partner's card is *likely* to hold —
  they played the boss of the suit and nobody still to act has shown a void
  in it (a known void means they can ruff, so the counter stays home).
  Otherwise win as cheaply as possible when there are points on the table
  (bid-team members and Aggressive contest even point-less tricks — the
  5-trick bonus and the last-trick go-down make every trick worth something
  to the declaring side).
- **Void:** ruff when there are points on the table, or early when the lead
  suit still has counters out that the players behind may be forced to drop
  ("trumping in on likely count"); never over a winning partner; otherwise
  pitch the cheapest non-trump — and only gift counters to a partner whose
  trick is safe.

### How play changes get accepted (mini-AlphaRook)

Every play heuristic is a `BotPersonality` flag, so candidate strategies are
A/B tested head-to-head: same bidding on both teams, one team with the trait,
600 full games with sides swapped each game (see the temporary harness
pattern in git history — `ab.scratch.test.ts`). Measured:

- `feedsBossPartner` — **57–58% game wins** vs. legacy. The single biggest
  play upgrade; shipped.
- `ruffsLikelyCount` — ~52% wins, +2.0 pts/hand; shipped.
- "save the boss trump, pull with the cheapest sufficient winner" — measured
  **neutral-to-negative** (50.2% alone, and it dragged combined arms down),
  so it was rejected: the bots already keep trump to the end by never
  discarding it, and pulling with the boss flushes enemy trump fastest.

The human intuition list from the family is the backlog; the sim harness is
the judge.

## AlphaRook (future)

The personality table is deliberately a pure function of `GameDoc` state, so
a learned policy can drop in behind the same `nextBotAction()` interface and
be benchmarked against `random` (floor) and `basic` (baseline) via the
existing full-game simulation harness in the test suite.
