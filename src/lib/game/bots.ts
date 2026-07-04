// Bot decision making. Pure: (GameDoc) -> GameAction | null.
// Two styles for now:
//   'random' — plays any legal move (the floor for future AlphaRook comparisons)
//   'basic'  — the heuristic bot carried over from v1 (trump length bidding,
//              point-aware trick play)

import {
    GameDoc, GameAction, Card, Seat, Suit, SUITS, VALID_BIDS,
    getCardPoints, partnerOf,
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

const chooseBid = (g: GameDoc, seat: Seat): number | 'pass' => {
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

const chooseCard = (g: GameDoc, seat: Seat, style: 'random' | 'basic'): Card => {
    const legal = legalCards(g, seat);
    if (style === 'random') {
        return legal[Math.floor(Math.random() * legal.length)];
    }

    const lead = leadSuit(g);
    const trump = g.trump;
    const played = g.trickPlays;
    const pointsOnTable = played.reduce((s, p) => s + getCardPoints(p.card), 0);

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

    const wouldWin = (card: Card): boolean =>
        winningCardSeat([...played, { seat, card }], trump) === seat;

    // Leading the trick
    if (!lead) {
        const trumps = trump ? legal.filter((c) => c.suit === trump) : [];
        if (trumps.length > 0) return highest(trumps); // pull trump
        const counts = groupBySuit(g.hands[seat]);
        const longHigh = legal.filter((c) => (counts.get(c.suit)?.length ?? 0) >= 3 && c.number >= 10);
        if (longHigh.length > 0) return highest(longHigh);
        return lowest(legal);
    }

    // Partner currently winning? dump points to them, otherwise stay cheap.
    const currentWinner = winningCardSeat(played, trump);
    const partnerWinning = currentWinner === partnerOf(seat);

    const followers = legal.filter((c) => c.suit === lead);
    if (followers.length > 0) {
        if (partnerWinning && played.length === 3) {
            // last to play and partner has it — feed the counters
            const counters = followers.filter((c) => getCardPoints(c) > 0 && !wouldWin(c));
            if (counters.length > 0) return highest(counters);
            return cheapest(followers);
        }
        if (pointsOnTable > 0 && !partnerWinning) {
            const winners = followers.filter(wouldWin);
            if (winners.length > 0) return lowest(winners);
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
    const style = seatInfo.botStyle ?? 'basic';
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
            return { type: 'BID', seat, bid: chooseBid(g, seat) };
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
