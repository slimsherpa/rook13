import { describe, it, expect } from 'vitest';
import { Card, GameDoc, HandSummary, Seat, Suit } from './types';
import { emptyStats, applyHandStats, applyGameFinalStats, rainbowNumbersFor } from './stats';

const c = (suit: Suit, number: number): Card => ({ suit, number });

/** A HandSummary with sane defaults, override what the test cares about. */
const hand = (over: Partial<HandSummary>): HandSummary => ({
    handNumber: 1,
    dealer: 'B2',
    bidWinner: 'B1',
    bid: 80,
    trump: 'Red',
    tricksWon: { A: 4, B: 5 },
    pointsTaken: { A: 40, B: 80 },
    handScore: { A: 40, B: 80 },
    wentSet: false,
    goDownPoints: 0,
    ...over,
});

/** 9 cards for A1: three 14s + filler; the fourth 14 hides in the widow. */
const threeFourteens: Card[] = [
    c('Red', 14), c('Yellow', 14), c('Black', 14),
    c('Red', 6), c('Red', 7), c('Yellow', 6), c('Yellow', 7), c('Black', 6), c('Black', 7),
];

const dealtWith = (a1: Card[]): Record<Seat, Card[]> => ({
    A1: a1,
    B1: [], A2: [], B2: [], // other seats irrelevant for A1's stats
});

describe('rainbowNumbersFor', () => {
    it('counts all four of a number in the dealt hand', () => {
        const h = hand({
            dealtHands: dealtWith([
                c('Red', 14), c('Yellow', 14), c('Black', 14), c('Green', 14),
                c('Red', 6), c('Red', 7), c('Yellow', 6), c('Yellow', 7), c('Black', 6),
            ]),
        });
        expect(rainbowNumbersFor(h, 'A1')).toEqual([14]);
    });

    it("the bid winner's widow pickup completes a rainbow (Riley's Rainbow 14)", () => {
        const h = hand({
            bidWinner: 'A1',
            dealtHands: dealtWith(threeFourteens),
            dealtWidow: [c('Green', 14), c('Green', 5), c('Green', 8), c('Green', 9)],
        });
        expect(rainbowNumbersFor(h, 'A1')).toEqual([14]);
    });

    it('the widow does NOT complete a rainbow for seats that never held it', () => {
        const h = hand({
            bidWinner: 'B1', // someone else took the widow
            dealtHands: dealtWith(threeFourteens),
            dealtWidow: [c('Green', 14), c('Green', 5), c('Green', 8), c('Green', 9)],
        });
        expect(rainbowNumbersFor(h, 'A1')).toEqual([]);
    });

    it('no dealt hand recorded → no rainbows (old games)', () => {
        expect(rainbowNumbersFor(hand({}), 'A1')).toEqual([]);
    });
});

describe('applyHandStats', () => {
    it('folds a made bid into the ledger and the records', () => {
        const s = emptyStats();
        applyHandStats(s, hand({ bidWinner: 'A1', bid: 100, wentSet: false }), 'A1');
        applyHandStats(s, hand({ bidWinner: 'A1', bid: 100, wentSet: false }), 'A1');
        applyHandStats(s, hand({ bidWinner: 'A1', bid: 120, wentSet: true }), 'A1');
        expect(s.bidsWon).toBe(3);
        expect(s.bidsMade).toBe(2);
        expect(s.timesSet).toBe(1);
        expect(s.madeByBid['100']).toBe(2);
        expect(s.highestBidMade).toBe(100);
        expect(s.highestBid).toBe(120); // the set still counts as your highest auction
        expect(s.handsPlayed).toBe(3);
    });

    it('defense and sweeps: setting the other team, taking every trick', () => {
        const s = emptyStats();
        // A1 defends, B1 goes set
        applyHandStats(s, hand({ bidWinner: 'B1', wentSet: true }), 'A1');
        // A1's team sweeps
        applyHandStats(s, hand({ tricksWon: { A: 9, B: 0 }, pointsTaken: { A: 120, B: 0 } }), 'A1');
        expect(s.setsDefended).toBe(1);
        expect(s.sweeps).toBe(1);
        expect(s.pointsCaptured).toBe(40 + 120);
    });

    it('dealt-hand records: count, zero-count, longest suit, rainbow counter', () => {
        const s = emptyStats();
        // 45 count: four 10-pointers + a 5
        applyHandStats(s, hand({
            dealtHands: dealtWith([
                c('Red', 10), c('Yellow', 10), c('Black', 10), c('Green', 10), c('Red', 5),
                c('Red', 6), c('Red', 7), c('Red', 8), c('Red', 9),
            ]),
        }), 'A1');
        // a zero-count hand, 7 of one suit
        applyHandStats(s, hand({
            dealtHands: dealtWith([
                c('Green', 6), c('Green', 7), c('Green', 8), c('Green', 9),
                c('Green', 11), c('Green', 12), c('Green', 14), c('Red', 6), c('Red', 7),
            ]),
        }), 'A1');
        expect(s.maxHandPoints).toBe(45);
        expect(s.zeroCountHands).toBe(1);
        expect(s.longestSuit).toBe(7);

        // two rainbow 14s across separate hands stack the counter
        const rainbowHand = hand({
            dealtHands: dealtWith([
                c('Red', 14), c('Yellow', 14), c('Black', 14), c('Green', 14),
                c('Red', 6), c('Red', 7), c('Yellow', 6), c('Yellow', 7), c('Black', 6),
            ]),
        });
        applyHandStats(s, rainbowHand, 'A1');
        applyHandStats(s, rainbowHand, 'A1');
        expect(s.rainbowCounts['14']).toBe(2);
    });
});

describe('applyGameFinalStats', () => {
    it('adds the game-level facts exactly once', () => {
        const s = emptyStats();
        const game = { winner: 'A', redealCount: 2, scores: { A: 500, B: 75 } } as GameDoc;
        applyGameFinalStats(s, game, 'A1');
        expect(s.gamesPlayed).toBe(1);
        expect(s.gamesWon).toBe(1);
        expect(s.redealsWitnessed).toBe(2);
        applyGameFinalStats(s, game, 'B1'); // the losing side
        expect(s.gamesPlayed).toBe(2);
        expect(s.gamesWon).toBe(1);
    });

    it('tracks the widest margin of victory, winners only, keeping the max', () => {
        const s = emptyStats();
        // a 425-point blowout win for team A
        applyGameFinalStats(s, { winner: 'A', redealCount: 0, scores: { A: 500, B: 75 } } as GameDoc, 'A1');
        expect(s.widestWinMargin).toBe(425);
        // the losing side of that same game records nothing (negative margin ignored)
        applyGameFinalStats(s, { winner: 'A', redealCount: 0, scores: { A: 500, B: 75 } } as GameDoc, 'B1');
        expect(s.widestWinMargin).toBe(425);
        // a narrower win does not lower the record
        applyGameFinalStats(s, { winner: 'B', redealCount: 0, scores: { A: 480, B: 510 } } as GameDoc, 'B2');
        expect(s.widestWinMargin).toBe(425);
        // a wider win raises it
        applyGameFinalStats(s, { winner: 'A', redealCount: 0, scores: { A: 505, B: -60 } } as GameDoc, 'A2');
        expect(s.widestWinMargin).toBe(565);
    });
});
