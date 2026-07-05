// Bot decision making. Pure: (GameDoc) -> GameAction | null.
//
// Styles (see BotStyle in types.ts):
//   'random'     — plays any legal move (the floor for future AlphaRook comparisons)
//   'basic'      — the standard heuristic bot: counts cards, pulls trump only
//                  while it's winning that fight, saves boss cards for later
//   'aggressive' — standard brain, bids ~one step harder, hunts tricks
//   'cautious'   — standard brain, bids ~one step tighter, hoards trump
//
// The heuristic bots "remember" only what a human at the table could:
// completed tricks, the current trick, and their own hand. They never peek
// at other hands or the hidden go-down.

import {
    GameDoc, GameAction, Card, Seat, Suit, SUITS, VALID_BIDS, BotStyle,
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

/** Pick the 4 weakest non-trump cards for the go-down (avoids counters when it can). */
export const chooseGoDown = (hand: Card[], trump: Suit): Card[] => {
    const candidates = [...hand].sort((a, b) => {
        const aTrump = a.suit === trump ? 1 : 0;
        const bTrump = b.suit === trump ? 1 : 0;
        if (aTrump !== bTrump) return aTrump - bTrump;           // non-trump first
        const ap = getCardPoints(a);
        const bp = getCardPoints(b);
        if (ap !== bp) return ap - bp;                            // avoid throwing points
        return a.number - b.number;                               // weakest first
    });
    return candidates.slice(0, 4);
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

// ---------------------------------------------------------------------------
// Bidding
// ---------------------------------------------------------------------------

const STYLE_BID_ADJUST: Partial<Record<BotStyle, number>> = {
    aggressive: 12,
    cautious: -12,
};

const chooseBid = (g: GameDoc, seat: Seat, style: BotStyle): number | 'pass' => {
    if (mustBid(g)) return VALID_BIDS[0];

    const hand = g.hands[seat];
    const trump = bestTrumpSuit(hand);
    const trumpCards = hand.filter((c) => c.suit === trump);
    const goDown = chooseGoDown(hand, trump);
    const keeping = hand.filter((c) => !goDown.some((gd) => gd.suit === c.suit && gd.number === c.number));

    const trumpPoints = trumpCards.reduce((s, c) => s + getCardPoints(c), 0);
    let strength =
        trumpCards.length * 10 +
        trumpPoints * 3 +
        suitPower(trumpCards) / 2 +
        keeping.reduce((s, c) => s + getCardPoints(c), 0);

    // partner already in the auction? push a little harder
    const partnerBid = g.bids[partnerOf(seat)];
    if (typeof partnerBid === 'number') strength += 15;

    strength += STYLE_BID_ADJUST[style] ?? 0;

    let ceiling: number | null = null;
    if (strength >= 120) ceiling = 120;
    else if (strength >= 110) ceiling = 110;
    else if (strength >= 100) ceiling = 100;
    else if (strength >= 90) ceiling = 90;
    else if (strength >= 80) ceiling = 80;
    else if (strength >= 70) ceiling = 70;
    else if (strength >= 65) ceiling = 65;

    if (ceiling === null) return 'pass';
    const floor = minNextBid(g);
    if (floor === null || floor > ceiling) return 'pass';
    return floor; // bid up in minimum steps
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
const chooseLead = (g: GameDoc, seat: Seat, style: BotStyle): Card => {
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
        } else if (onBidTeam || style === 'aggressive') {
            // Pull trump only while it's a winning proposition:
            // with the boss trump, or with clear length dominance.
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

    const lead = leadSuit(g);
    const trump = g.trump;
    const played = g.trickPlays;
    const pointsOnTable = played.reduce((s, p) => s + getCardPoints(p.card), 0);

    const wouldWin = (card: Card): boolean =>
        winningCardSeat([...played, { seat, card }], trump) === seat;

    // Leading the trick
    if (!lead) return chooseLead(g, seat, style);

    // Partner currently winning? dump points to them, otherwise stay cheap.
    const currentWinner = winningCardSeat(played, trump);
    const partnerWinning = currentWinner === partnerOf(seat);
    const partnerCard = played.find((p) => p.seat === partnerOf(seat))?.card;
    // partner is winning with a card nothing can beat — safe to feed early
    const partnerHasItLocked =
        partnerWinning && !!partnerCard &&
        (partnerCard.suit === trump ? isBoss(g, seat, partnerCard)
            : isBoss(g, seat, partnerCard) && outstandingInSuit(g, seat, trump ?? partnerCard.suit).length === 0);

    const followers = legal.filter((c) => c.suit === lead);
    if (followers.length > 0) {
        if (partnerWinning && (played.length === 3 || partnerHasItLocked)) {
            // partner has it — feed the counters
            const counters = followers.filter((c) => getCardPoints(c) > 0 && !wouldWin(c));
            if (counters.length > 0) return highest(counters);
            return cheapest(followers);
        }
        if (!partnerWinning && (pointsOnTable > 0 || style === 'aggressive')) {
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
        if (trumps.length > 0 && !partnerWinning && (pointsOnTable > 0 || played.length <= 2)) {
            const winningTrumps = trumps.filter(wouldWin);
            if (winningTrumps.length > 0) return lowest(winningTrumps);
        }
    }
    if (partnerWinning) {
        const counters = legal.filter((c) => getCardPoints(c) > 0 && c.suit !== trump);
        if (counters.length > 0) return highest(counters);
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
            const trump = bestTrumpSuit(g.hands[seat]);
            if (style === 'random') {
                const shuffled = [...g.hands[seat]].sort(() => Math.random() - 0.5);
                return { type: 'SELECT_GODOWN', seat, cards: shuffled.slice(0, 4) };
            }
            return { type: 'SELECT_GODOWN', seat, cards: chooseGoDown(g.hands[seat], trump) };
        }
        case 'trump': {
            if (style === 'random') {
                const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
                return { type: 'SELECT_TRUMP', seat, suit };
            }
            return { type: 'SELECT_TRUMP', seat, suit: bestTrumpSuit(g.hands[seat]) };
        }
        case 'playing':
            return { type: 'PLAY_CARD', seat, card: chooseCard(g, seat, style) };
        default:
            return null;
    }
};
