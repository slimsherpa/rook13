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

Easy ignores all of it and plays any legal move — it exists as the floor to
measure future bots (AlphaRook) against.

## Bidding

1. **Hand evaluation.** `estimateTricks()` scores the 9-card hand with its
   best suit as trump: trump honors (14/13/12/11), trump length past 4, side
   bosses, and short side suits it can ruff (each ruff reserves a spare
   trump).
2. **Tricks → points.** `TRICK_TO_POINTS` (base 72, +11/trick) converts the
   estimate into the most the bot will pay. The line is grounded in a fit
   over ~1,500 simulated hands with randomized contracts (actual declaring-
   team points ≈ 72 + 7 × tricks; the big intercept is real — trump choice,
   the widow, and an average partner are a big head start). The bidding slope
   is steeper than the fitted reality on purpose: strong hands press their
   edge like humans do, and yes, that means the winner's curse is alive at
   this table too.
3. **Auction manners.**
   - Bid up in minimum +5 steps — never jump. This produces the natural
     "feeling out the table" bids at 70–85 on the way to the real price.
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

### Calibrated outcome (family complaint #1)

Measured over ~1,600 bot-vs-bot hands per lineup:

- All-Standard table: winning bids mean ≈ 91, median 90–95; 100 ≈ 13%,
  105 ≈ 5%, 110 ≈ 1.5%, 115/120 well under 1%. Set rate ≈ 32%.
- Mixed table (with an Aggressive seat): median 95, 100 ≈ 17%, set rate ≈ 36%
  — Aggressive buys more hands and sets more, which is the point.

This sits about half a bid-step below the family's human meta ("100 typical,
95/105 common"). Pushing the center to a true 100 with current play strength
drives set rates past 43% (the per-hand luck spread is ~24 points), which
reads as dumb bidding, not bold bidding. If playtesting says the bots are
still too timid, raise `TRICK_TO_POINTS.base` (each +1 ≈ +1 bid point,
roughly +1.5% set rate); genuinely closing the gap is AlphaRook's job —
better card play raises real points taken, and the bid line can follow.

## Widow, go-down, and trump

The bid winner picks the trump suit that maximizes `estimateTricksAs()` over
the 13 cards, then brute-forces all 715 possible 4-card go-downs and keeps
the discard that leaves the strongest 9 cards — which naturally hoards trump,
empties short side suits to create ruffing voids, keeps side bosses, and
avoids burying counters (their points ride on winning the last trick). The
trump declaration recomputes the same objective on the kept 9 so the named
suit always matches what the discard was shaped around.

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
