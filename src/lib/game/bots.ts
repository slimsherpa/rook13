// Bot decision making. Pure: (GameDoc) -> GameAction | null.
//
// Each BotStyle maps to a personality — a small table of knobs (see
// PERSONALITIES below) that shape bidding appetite and table manners:
//   'random'     — "Easy": any legal move (the floor for future AlphaRook comparisons)
//   'basic'      — "Standard": bids what the hand is worth minus a small cushion
//   'aggressive' — bids right up to the estimate, stretches in bidding wars,
//                  pulls trump on defense, hunts tricks
//   'cautious'   — bids well under the estimate, never outbids partner,
//                  hoards trump for sure things
//
// Bidding is grounded in an empirical model: estimateTricks() scores the
// 9-card hand, and TRICK_TO_POINTS maps that to the points the team actually
// takes when it wins the bid (constants fitted from simulated hands — see
// bots.test.ts "calibration"). Two table-manner rules from the family:
//   - never bid when your partner holds the high bid and both opponents have
//     passed (you'd only be raising your own contract), and
//   - only outbid a partner in a live auction with a clearly stronger hand.
//
// The heuristic bots "remember" only what a human at the table could:
// completed tricks, the current trick, and their own hand. They never peek
// at other hands or the hidden go-down.

import {
    GameDoc, GameAction, Card, Seat, Suit, SEATS, SUITS, VALID_BIDS, BotStyle,
    getCardPoints, partnerOf, teamOf,
} from './types';
import { createShuffledDeck } from './deck';
import { legalCards, leadSuit, minNextBid, mustBid, winningCardSeat } from './engine';

const suitPower = (cards: Card[]): number => cards.reduce((s, c) => s + c.number, 0);

const groupBySuit = (hand: Card[]): Map<Suit, Card[]> => {
    const m = new Map<Suit, Card[]>();
    for (const c of hand) {
        if (!m.has(c.suit)) m.set(c.suit, []);
        m.get(c.suit)!.push(c);
    }
    return m;
};

export const bestTrumpSuit = (hand: Card[]): Suit => {
    const groups = groupBySuit(hand);
    let best: Suit = SUITS[0];
    let bestLen = -1;
    let bestPower = -1;
    for (const suit of SUITS) {
        const cards = groups.get(suit) ?? [];
        const len = cards.length;
        const power = suitPower(cards);
        if (len > bestLen || (len === bestLen && power > bestPower)) {
            best = suit;
            bestLen = len;
            bestPower = power;
        }
    }
    return best;
};

/**
 * Pick the 4-card go-down that leaves the strongest 9 cards behind: brute
 * force every discard set (13 choose 4 = 715) and keep the one that maximizes
 * the trick estimate — which naturally hoards trump, creates voids to ruff
 * with, and keeps side bosses. `buryPenalty` prices burying counters in the
 * go-down (points there ride on winning the last trick): positive avoids it,
 * negative treats the go-down as a bank for loose counters.
 *
 * Family law: trump never goes in the go-down (unless the hand physically
 * forces it by holding 10+ trump).
 */
export const chooseGoDown = (hand: Card[], trump: Suit, buryPenalty = -0.06): Card[] => {
    const nonTrump = hand.filter((c) => c.suit !== trump);
    const pool = nonTrump.length >= 4 ? nonTrump : hand;
    const n = pool.length;
    let best: Card[] = pool.slice(0, 4);
    let bestScore = -Infinity;
    for (let i = 0; i < n - 3; i++) {
        for (let j = i + 1; j < n - 2; j++) {
            for (let k = j + 1; k < n - 1; k++) {
                for (let l = k + 1; l < n; l++) {
                    const drop = [pool[i], pool[j], pool[k], pool[l]];
                    const keep = hand.filter((c) => !drop.includes(c));
                    const buried = drop.reduce((s, c) => s + getCardPoints(c), 0);
                    const score = estimateTricksAs(keep, trump) - buried * buryPenalty;
                    if (score > bestScore) {
                        bestScore = score;
                        best = drop;
                    }
                }
            }
        }
    }
    return best;
};

// ---------------------------------------------------------------------------
// Personalities
// ---------------------------------------------------------------------------

export interface BotPersonality {
    /** points shaved off the raw hand estimate before bidding */
    bidCushion: number;
    /** won't open their mouth at all below this many estimated tricks */
    minBidTricks: number;
    /**
     * Widow optimism, in tricks, relative to reality. The fitted
     * TRICK_TO_POINTS curve already includes the average widow lift, so this
     * is temperament: >0 counts on a good widow, <0 refuses to.
     */
    widowTricks: number;
    /** extra points past comfort it will pay when an opponent holds the high bid */
    warStretch: number;
    /** how far above the going rate the hand must be to jump-bid a statement */
    jumpGap: number;
    /** points held back below comfort when jumping (0 = jump to the max) */
    jumpReserve: number;
    /**
     * How much stronger (estimate minus the price it would have to pay) the
     * hand must be to take the bid away from a partner while opponents are
     * still live. null = never outbids partner.
     */
    partnerOverbidMargin: number | null;
    /** pulls trump even when its team is defending */
    pullsTrumpOnDefense: boolean;
    /** tries to win tricks even with no points on the table */
    huntsBareTricks: boolean;
    /** ruffs in early even before any points have hit the table */
    eagerRuffer: boolean;
    /** feeds counters on partner's *likely* wins (not just guaranteed ones) */
    feedsBossPartner: boolean;
    /** ruffs in early when the lead suit still has counters likely to drop */
    ruffsLikelyCount: boolean;
    /** go-down pricing for buried counters (see chooseGoDown) */
    goDownBuryPenalty: number;
}

export const PERSONALITIES: Record<BotStyle, BotPersonality> = {
    // 'random' never consults its personality; zeros keep the record total.
    random: {
        bidCushion: 0, minBidTricks: 0, widowTricks: 0, warStretch: 0, jumpGap: 99, jumpReserve: 0, partnerOverbidMargin: null,
        pullsTrumpOnDefense: false, huntsBareTricks: false, eagerRuffer: false,
        feedsBossPartner: false, ruffsLikelyCount: false, goDownBuryPenalty: 0.04,
    },
    basic: {
        bidCushion: 3, minBidTricks: 0.8, widowTricks: 0, warStretch: 0, jumpGap: 20, jumpReserve: 5, partnerOverbidMargin: 15,
        pullsTrumpOnDefense: false, huntsBareTricks: false, eagerRuffer: true,
        feedsBossPartner: true, ruffsLikelyCount: true, goDownBuryPenalty: -0.06,
    },
    aggressive: {
        bidCushion: 0, minBidTricks: 0.4, widowTricks: 0.3, warStretch: 5, jumpGap: 15, jumpReserve: 5, partnerOverbidMargin: 10,
        pullsTrumpOnDefense: true, huntsBareTricks: true, eagerRuffer: true,
        feedsBossPartner: true, ruffsLikelyCount: true, goDownBuryPenalty: -0.06,
    },
    cautious: {
        bidCushion: 8, minBidTricks: 1.5, widowTricks: -0.3, warStretch: 0, jumpGap: 25, jumpReserve: 10, partnerOverbidMargin: null,
        pullsTrumpOnDefense: false, huntsBareTricks: false, eagerRuffer: false,
        feedsBossPartner: true, ruffsLikelyCount: true, goDownBuryPenalty: -0.06,
    },
    // AlphaRook bids/discards like Standard; its card play is replaced by
    // Monte Carlo search in src/lib/alpharook/agent.ts (nextAgentAction).
    alpharook: {
        bidCushion: 3, minBidTricks: 0.8, widowTricks: 0, warStretch: 0, jumpGap: 20, jumpReserve: 5, partnerOverbidMargin: 15,
        pullsTrumpOnDefense: false, huntsBareTricks: false, eagerRuffer: true,
        feedsBossPartner: true, ruffsLikelyCount: true, goDownBuryPenalty: -0.06,
    },
    // The trained brains bid and play cards neurally (agent.ts); these knobs
    // only cover their heuristic go-down/trump — Standard's, matching the
    // scripted go-down their arena results were measured with — and serve as
    // the whole-seat fallback if the weights can't be fetched.
    gen7: {
        bidCushion: 3, minBidTricks: 0.8, widowTricks: 0, warStretch: 0, jumpGap: 20, jumpReserve: 5, partnerOverbidMargin: 15,
        pullsTrumpOnDefense: false, huntsBareTricks: false, eagerRuffer: true,
        feedsBossPartner: true, ruffsLikelyCount: true, goDownBuryPenalty: -0.06,
    },
    gen8: {
        bidCushion: 3, minBidTricks: 0.8, widowTricks: 0, warStretch: 0, jumpGap: 20, jumpReserve: 5, partnerOverbidMargin: 15,
        pullsTrumpOnDefense: false, huntsBareTricks: false, eagerRuffer: true,
        feedsBossPartner: true, ruffsLikelyCount: true, goDownBuryPenalty: -0.06,
    },
};

// ---------------------------------------------------------------------------
// Card memory: everything this seat has legitimately seen this hand.
// ---------------------------------------------------------------------------

const cardsSeenBy = (g: GameDoc, seat: Seat): Card[] => [
    ...g.completedTricks.flatMap((t) => t.plays.map((p) => p.card)),
    ...g.trickPlays.map((p) => p.card),
    ...g.hands[seat],
];

/** Cards of `suit` still out there (not seen by `seat`). Some may be buried in the go-down. */
const outstandingInSuit = (g: GameDoc, seat: Seat, suit: Suit): number[] => {
    const seen = new Set(
        cardsSeenBy(g, seat).filter((c) => c.suit === suit).map((c) => c.number),
    );
    const out: number[] = [];
    for (let n = 5; n <= 14; n++) if (!seen.has(n)) out.push(n);
    return out;
};

/** True when nothing left in the suit can beat this card. */
const isBoss = (g: GameDoc, seat: Seat, card: Card): boolean => {
    const out = outstandingInSuit(g, seat, card.suit);
    return out.every((n) => n < card.number);
};

/** True when `who` has already shown (by not following) that they're out of `suit`. */
const knownVoid = (g: GameDoc, who: Seat, suit: Suit): boolean =>
    [...g.completedTricks.map((t) => t.plays), g.trickPlays].some(
        (plays) =>
            plays.length > 0 &&
            plays[0].card.suit === suit &&
            plays.some((pl) => pl.seat === who && pl.card.suit !== suit),
    );

// ---------------------------------------------------------------------------
// Bidding
// ---------------------------------------------------------------------------

/**
 * Expected tricks if this hand plays with `trump` as trump. Honors, length,
 * side bosses, and ruffing shortness all contribute.
 */
export const estimateTricksAs = (hand: Card[], trump: Suit): number => {
    const groups = groupBySuit(hand);
    const trumps = groups.get(trump) ?? [];

    let tricks = 0;
    for (const c of trumps) {
        if (c.number === 14) tricks += 1.0;
        else if (c.number === 13) tricks += 0.8;
        else if (c.number === 12) tricks += 0.5;
        else if (c.number === 11) tricks += 0.3;
    }
    // trump length is king: the 4th trump helps, the 5th and beyond win the
    // war of attrition outright (and make the widow/go-down shaping pay more)
    if (trumps.length >= 4) tricks += 0.4;
    tricks += Math.max(0, trumps.length - 4) * 0.9;

    // side-suit bosses and ruffing shortness (needs spare trumps to ruff with)
    let spareTrumps = Math.max(0, trumps.length - 3);
    for (const suit of SUITS) {
        if (suit === trump) continue;
        const cards = groups.get(suit) ?? [];
        const nums = new Set(cards.map((c) => c.number));
        if (nums.has(14)) tricks += 0.8;
        if (nums.has(13)) tricks += nums.has(14) ? 0.45 : 0.25;
        if (cards.length === 0 && spareTrumps > 0) {
            tricks += 0.9;
            spareTrumps--;
        } else if (cards.length === 1 && spareTrumps > 0) {
            tricks += 0.45;
            spareTrumps--;
        }
    }
    return Math.min(9, tricks);
};

/** Expected tricks if this hand wins the bid and names its best suit trump. */
export const estimateTricks = (hand: Card[]): number =>
    estimateTricksAs(hand, bestTrumpSuit(hand));

/**
 * Tricks -> the points a bot is willing to bid on. Reality, refitted over
 * ~2000 simulated hands with randomized contracts, is ≈ 71 + 8.5t (the high
 * intercept is real — naming trump + the widow + partner's average hand is a
 * big head start). The willingness line here is deliberately *flatter* and
 * anchored higher: at this family's table everyone knows a takeable hand is
 * worth about 100, and hand strength only nudges the price. That compression
 * is what makes 100 the most common winning bid (95/105 common, 90/110 rare)
 * — and it carries the same winner's-curse set rate (~40%) the human meta
 * does. Move `base` to shift the whole distribution (±1 ≈ ±1 bid point).
 */
const TRICK_TO_POINTS = { base: 86, perTrick: 6 };

/** Partner opened their mouth — their tricks count toward the team too. */
const PARTNER_BID_BOOST = 8;
/** Partner passed — expect no help across the table. */
const PARTNER_PASS_DRAG = 4;

const expectedPoints = (hand: Card[], widowTricks: number): number =>
    TRICK_TO_POINTS.base + TRICK_TO_POINTS.perTrick * (estimateTricks(hand) + widowTricks);

/** Highest valid bid at or below `points`, or null if even 65 is too rich. */
const snapToBid = (points: number): number | null => {
    let best: number | null = null;
    for (const b of VALID_BIDS) {
        if (b <= points) best = b;
    }
    return best;
};

const chooseBid = (g: GameDoc, seat: Seat, style: BotStyle): number | 'pass' => {
    if (mustBid(g)) return VALID_BIDS[0];
    const floor = minNextBid(g);
    if (floor === null) return 'pass';

    const p = PERSONALITIES[style];
    const tricks = estimateTricks(g.hands[seat]);
    // junk is junk — humans pass it no matter what the math says a random
    // partner might contribute
    if (tricks < p.minBidTricks) return 'pass';

    const partner = partnerOf(seat);
    const partnerBid = g.bids[partner];
    const partnerHasHighBid = g.highBid !== null && partnerBid === g.highBid;

    let estimate = expectedPoints(g.hands[seat], p.widowTricks) - p.bidCushion;
    // read the table: a partner who bid brings tricks of their own (but never
    // let partner's strength justify outbidding that same partner), a partner
    // who passed won't be much help
    if (typeof partnerBid === 'number' && !partnerHasHighBid) estimate += PARTNER_BID_BOOST;
    else if (partnerBid === 'pass') estimate -= PARTNER_PASS_DRAG;
    const comfort = snapToBid(estimate);
    if (comfort === null) return 'pass';

    if (partnerHasHighBid) {
        const opponentsAlive = SEATS.some(
            (s) => teamOf(s) !== teamOf(seat) && g.bids[s] !== 'pass',
        );
        // Both opponents folded: the bid is already ours at partner's price.
        // Bidding again would only raise our own contract.
        if (!opponentsAlive) return 'pass';
        // Live auction: leave it to partner unless this hand is clearly
        // stronger even at the raised price.
        if (p.partnerOverbidMargin === null) return 'pass';
        return floor + p.partnerOverbidMargin <= comfort ? floor : 'pass';
    }

    // An opponent holds the high bid — some personalities pay a little extra
    // rather than hand it over.
    const opponentHasHighBid = g.highBid !== null;
    const limit = comfort + (opponentHasHighBid ? p.warStretch : 0);
    if (floor > limit) return 'pass';
    // jump bidding: with a hand far above the going rate, make a statement
    // bid that clears out the creepers instead of walking up in 5s. A
    // statement tops out at 105 — anything past that only happens when a
    // real bidding war forces it, one step at a time.
    if (comfort - floor >= p.jumpGap) {
        return Math.max(floor, Math.min(limit, comfort - p.jumpReserve, 105));
    }
    return floor;
};

// ---------------------------------------------------------------------------
// Trick play
// ---------------------------------------------------------------------------

const lowest = (cards: Card[]) =>
    cards.reduce((lo, c) => (c.number < lo.number ? c : lo), cards[0]);
const highest = (cards: Card[]) =>
    cards.reduce((hi, c) => (c.number > hi.number ? c : hi), cards[0]);
const cheapest = (cards: Card[]) =>
    cards.reduce((lo, c) => {
        const cp = getCardPoints(c);
        const lp = getCardPoints(lo);
        return cp < lp || (cp === lp && c.number < lo.number) ? c : lo;
    }, cards[0]);

/** What to lead when opening a trick. */
const chooseLead = (g: GameDoc, seat: Seat, p: BotPersonality): Card => {
    const hand = g.hands[seat];
    const trump = g.trump;
    const myTrumps = trump ? hand.filter((c) => c.suit === trump) : [];
    const sideCards = hand.filter((c) => c.suit !== trump);
    const onBidTeam = g.bidWinner !== null && teamOf(g.bidWinner) === teamOf(seat);

    // --- trump management (the fix for "plays all trump first") ---
    if (trump && myTrumps.length > 0) {
        const enemyTrumps = outstandingInSuit(g, seat, trump);
        const haveBoss = enemyTrumps.every((n) => n < highest(myTrumps).number);

        if (enemyTrumps.length === 0) {
            // trump is dead — stop leading it, cash side winners instead
            // (fall through to side-suit logic; trump stays as late control)
        } else if (onBidTeam || p.pullsTrumpOnDefense) {
            // Pull trump only while it's a winning proposition:
            // with the boss trump, or with clear length dominance.
            // (A/B tested "pull with the cheapest sufficient winner to save
            // the boss for the endgame" — it measured neutral-to-negative,
            // so the boss leads the charge.)
            if (haveBoss) return highest(myTrumps);
            if (myTrumps.length > enemyTrumps.length && myTrumps.length >= 3) {
                // force theirs out with a mid trump, keep the point cards home
                const nonCounters = myTrumps.filter((c) => getCardPoints(c) === 0);
                return highest(nonCounters.length > 0 ? nonCounters : myTrumps);
            }
            // otherwise: don't bleed trump — play side suits, save trump for
            // ruffs and the endgame
        }
        // defenders never lead trump while they have any side suit
        if (sideCards.length === 0) return highest(myTrumps);
    }

    const pool = sideCards.length > 0 ? sideCards : hand;

    // cash a certain side winner if we have one
    const bosses = pool.filter((c) => isBoss(g, seat, c) && c.suit !== trump);
    if (bosses.length > 0) {
        // prefer the boss from our longest suit (keeps control longer)
        const counts = groupBySuit(hand);
        return bosses.reduce((best, c) =>
            (counts.get(c.suit)?.length ?? 0) > (counts.get(best.suit)?.length ?? 0) ? c : best,
        bosses[0]);
    }

    // no sure winner: lead low from a long suit, and never gift a counter
    const nonCounters = pool.filter((c) => getCardPoints(c) === 0);
    if (nonCounters.length > 0) {
        const counts = groupBySuit(hand);
        const longSuitLen = Math.max(...nonCounters.map((c) => counts.get(c.suit)?.length ?? 0));
        const fromLong = nonCounters.filter((c) => (counts.get(c.suit)?.length ?? 0) === longSuitLen);
        return lowest(fromLong);
    }
    return cheapest(pool);
};

const chooseCard = (g: GameDoc, seat: Seat, style: BotStyle): Card => {
    const legal = legalCards(g, seat);
    if (style === 'random') {
        return legal[Math.floor(Math.random() * legal.length)];
    }
    const p = PERSONALITIES[style];

    const lead = leadSuit(g);
    const trump = g.trump;
    const played = g.trickPlays;
    const pointsOnTable = played.reduce((s, pl) => s + getCardPoints(pl.card), 0);
    // the declaring team fights for every trick: each one feeds the 5-trick
    // bonus, keeps the lead, and guards the go-down on the last trick
    const onBidTeam = g.bidWinner !== null && teamOf(g.bidWinner) === teamOf(seat);

    const wouldWin = (card: Card): boolean =>
        winningCardSeat([...played, { seat, card }], trump) === seat;

    // Leading the trick
    if (!lead) return chooseLead(g, seat, p);

    // Partner currently winning? dump points to them, otherwise stay cheap.
    const currentWinner = winningCardSeat(played, trump);
    const partnerWinning = currentWinner === partnerOf(seat);
    const partnerCard = played.find((pl) => pl.seat === partnerOf(seat))?.card;
    // partner is winning with a card that's safe to feed: the boss of the
    // suit, and nobody left to act can (or is known to be able to) ruff it.
    // feedsBossPartner trusts "not known void" as safe; without it, feeding
    // waits for a mathematical lock (all trump accounted for).
    const playedSeats = new Set(played.map((pl) => pl.seat));
    const oppsBehind = SEATS.filter(
        (s) => teamOf(s) !== teamOf(seat) && !playedSeats.has(s),
    );
    const trumpsStillOut = trump ? outstandingInSuit(g, seat, trump).length : 0;
    const partnerHasItLocked =
        partnerWinning && !!partnerCard && isBoss(g, seat, partnerCard) &&
        (partnerCard.suit === trump ||
            trumpsStillOut === 0 ||
            (p.feedsBossPartner && oppsBehind.every((o) => !knownVoid(g, o, partnerCard.suit))));

    const followers = legal.filter((c) => c.suit === lead);
    if (followers.length > 0) {
        if (partnerWinning && (played.length === 3 || partnerHasItLocked)) {
            // partner has it — feed the counters
            const counters = followers.filter((c) => getCardPoints(c) > 0 && !wouldWin(c));
            if (counters.length > 0) return highest(counters);
            return cheapest(followers);
        }
        if (!partnerWinning && (pointsOnTable > 0 || p.huntsBareTricks || onBidTeam)) {
            const winners = followers.filter(wouldWin);
            if (winners.length > 0) {
                // last to act wins as cheaply as possible; earlier, top them
                // properly so the 4th hand can't cheaply overtake
                return played.length === 3 ? lowest(winners) : highest(winners);
            }
        }
        return cheapest(followers);
    }

    // Void in the lead suit
    if (trump) {
        const trumps = legal.filter((c) => c.suit === trump);
        // "likely count": players still to act must follow the lead suit, and
        // that suit has counters left that may be forced out onto this trick
        const leadCountersOut = lead
            ? outstandingInSuit(g, seat, lead).filter((n) => n === 5 || n === 10 || n === 13).length
            : 0;
        const worthRuffing =
            pointsOnTable > 0 ||
            (p.eagerRuffer && played.length <= 2) ||
            (p.ruffsLikelyCount && played.length <= 2 && leadCountersOut > 0);
        if (trumps.length > 0 && !partnerWinning && worthRuffing) {
            const winningTrumps = trumps.filter(wouldWin);
            if (winningTrumps.length > 0) return lowest(winningTrumps);
        }
    }
    if (partnerWinning) {
        // don't gift a counter onto a trick partner might still lose
        const feedSafe = !p.feedsBossPartner || played.length === 3 || partnerHasItLocked;
        const counters = legal.filter((c) => getCardPoints(c) > 0 && c.suit !== trump);
        if (feedSafe && counters.length > 0) return highest(counters);
    }
    const nonTrump = legal.filter((c) => c.suit !== trump);
    return cheapest(nonTrump.length > 0 ? nonTrump : legal);
};

/**
 * When the game is waiting on a bot, produce its action; otherwise null.
 * Deal/redeal shuffles are generated here (the caller records them in the log).
 */
export const nextBotAction = (g: GameDoc): GameAction | null => {
    if (g.status !== 'active' || !g.turn) {
        // hand_done needs no seat turn — any client may advance; the bot runner
        // auto-advances only when the *next* dealer is a bot.
        if (g.status === 'active' && g.phase === 'hand_done') return null;
        return null;
    }
    const seatInfo = g.seats[g.turn];
    if (seatInfo.kind !== 'bot') return null;
    const style: BotStyle = seatInfo.botStyle ?? 'basic';
    const seat = g.turn;

    switch (g.phase) {
        case 'dealing':
            return { type: 'DEAL', deck: createShuffledDeck() };
        case 'redeal':
            return { type: 'ACK_REDEAL', deck: createShuffledDeck() };
        case 'bidding': {
            if (style === 'random') {
                const floor = minNextBid(g);
                if (mustBid(g)) return { type: 'BID', seat, bid: VALID_BIDS[0] };
                const bid = floor !== null && Math.random() < 0.25 ? floor : 'pass';
                return { type: 'BID', seat, bid };
            }
            return { type: 'BID', seat, bid: chooseBid(g, seat, style) };
        }
        case 'widow': {
            if (style === 'random') {
                const shuffled = [...g.hands[seat]].sort(() => Math.random() - 0.5);
                return { type: 'SELECT_GODOWN', seat, cards: shuffled.slice(0, 4) };
            }
            // family law: the longest suit is trump — shape the discard around it
            const trump = bestTrumpSuit(g.hands[seat]);
            const cards = chooseGoDown(g.hands[seat], trump, PERSONALITIES[style].goDownBuryPenalty);
            return { type: 'SELECT_GODOWN', seat, cards };
        }
        case 'trump': {
            if (style === 'random') {
                const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
                return { type: 'SELECT_TRUMP', seat, suit };
            }
            // longest suit of the kept hand — matches what the go-down was
            // shaped around (all trump was kept, so it's still the longest)
            return { type: 'SELECT_TRUMP', seat, suit: bestTrumpSuit(g.hands[seat]) };
        }
        case 'playing':
            return { type: 'PLAY_CARD', seat, card: chooseCard(g, seat, style) };
        default:
            return null;
    }
};
