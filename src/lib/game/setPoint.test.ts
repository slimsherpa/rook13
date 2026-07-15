import { describe, it, expect } from 'vitest';
import { setSealedTrick } from './setPoint';
import { HandSummary, TrickRecord, Seat } from './types';

// Team A = A1/A2, Team B = B1/B2. Real hands always play all 9 tricks, and
// setSealedTrick reads tricksLeft from the array length, so every case here
// supplies a full 9-trick hand.
const mkTrick = (winner: Seat, points: number): TrickRecord => ({
    leader: 'A1', winner, points, plays: [],
});

// bidWinner A1 → the bidding team is A.
const summary = (bid: number, wentSet = true): HandSummary => ({
    handNumber: 1, dealer: 'B2', bidWinner: 'A1', bid, trump: 'Red',
    tricksWon: { A: 0, B: 0 }, pointsTaken: { A: 0, B: 0 },
    handScore: { A: 0, B: 0 }, wentSet, goDownPoints: 0,
});

// pad a partial trick list out to 9 with zero-point A wins
const nine = (...tricks: TrickRecord[]): TrickRecord[] => {
    const out = [...tricks];
    while (out.length < 9) out.push(mkTrick('A1', 0));
    return out;
};

describe('setSealedTrick', () => {
    it('returns -1 when the hand was made', () => {
        expect(setSealedTrick(nine(), summary(80, false))).toBe(-1);
    });

    it('seals the moment the defenders bank the bid out of reach (bonus still live)', () => {
        // bid 80: with the 5-trick bonus reachable, A's max is 100−def+20, so
        // the set locks once defenders bank more than 40. B scoops 20, 15, 10
        // → after trick 3 (index 2) def=45, max=75 < 80.
        const tricks = nine(mkTrick('B1', 20), mkTrick('B2', 15), mkTrick('B1', 10));
        expect(setSealedTrick(tricks, summary(80))).toBe(2);
    });

    it('once the 5-trick bonus is out of reach the bar tightens to 100', () => {
        // A wins only trick 1, then B runs the table banking 5 a trick. The
        // bonus dies when A can no longer reach 5 tricks — at index 5 (4 left,
        // 1 won) — and with def=25 the no-bonus max 75 < 80 seals it there.
        const tricks = nine(
            mkTrick('A1', 0),
            mkTrick('B1', 5), mkTrick('B1', 5), mkTrick('B1', 5),
            mkTrick('B1', 5), mkTrick('B1', 5), mkTrick('B1', 5),
        );
        expect(setSealedTrick(tricks, summary(80))).toBe(5);
    });

    it('falls back to the final trick when the set only settles at the count', () => {
        // A could always have reached a low bid (defenders barely bank), so
        // nothing forces it early — the beat lands on the last trick.
        const tricks = nine(
            mkTrick('B1', 5), mkTrick('A1', 0), mkTrick('A1', 0), mkTrick('B1', 5),
        );
        expect(setSealedTrick(tricks, summary(50))).toBe(8);
    });
});
