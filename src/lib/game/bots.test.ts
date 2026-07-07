// Bot personality + bidding behavior tests.
//
// The calibration suite at the bottom is statistical: it plays full bot-vs-bot
// games and checks the winning-bid distribution against the family meta
// (95-ish typical, 90/100 common, tails above 110 rare). Bounds are loose on
// purpose — they guard against regressions like "bots bid 120 again", not
// exact percentages.

import { describe, it, expect } from 'vitest';
import { GameDoc, Card, Seat, SeatInfo, Suit, SEATS, BotStyle, getCardPoints } from './types';
import { createGameDoc, applyAction } from './engine';
import { nextBotAction, estimateTricks, chooseGoDown } from './bots';

const host = { uid: 'host', name: 'Host' };
const c = (suit: Suit, number: number): Card => ({ suit, number });

/** A monster: long boss trump, side aces. Worth bidding to the roof. */
const MONSTER: Card[] = [
    c('Red', 14), c('Red', 13), c('Red', 12), c('Red', 11), c('Red', 10),
    c('Red', 9), c('Red', 8),
    c('Green', 14), c('Black', 14),
];

/** Junk: no honors, no length anywhere. */
const JUNK: Card[] = [
    c('Red', 6), c('Red', 7), c('Yellow', 6), c('Yellow', 8),
    c('Black', 7), c('Black', 9), c('Green', 6), c('Green', 8), c('Green', 9),
];

/** A middling hand: some trump length and an honor, nothing scary. */
const MIDDLING: Card[] = [
    c('Red', 13), c('Red', 11), c('Red', 9), c('Red', 6),
    c('Yellow', 14), c('Yellow', 7),
    c('Black', 8), c('Green', 9), c('Green', 7),
];

/**
 * A game frozen mid-bidding with everything overridable: whose turn it is,
 * what they hold, what's been bid so far.
 */
const biddingState = (opts: {
    turn: Seat;
    hand: Card[];
    style: BotStyle;
    bids: Partial<Record<Seat, number | 'pass'>>;
    highBid: number | null;
}): GameDoc => {
    let g = createGameDoc({ id: 'bid-test', joinCode: 'BIDT', host, now: 1 });
    g = applyAction(g, { type: 'START_GAME' });
    while (g.phase === 'dealing' || g.phase === 'redeal') {
        g = applyAction(g, nextBotAction(g)!);
    }
    expect(g.phase).toBe('bidding');
    return {
        ...g,
        turn: opts.turn,
        hands: { ...g.hands, [opts.turn]: opts.hand },
        seats: { ...g.seats, [opts.turn]: { kind: 'bot' as const, name: 'Bot', botStyle: opts.style } },
        bids: opts.bids,
        highBid: opts.highBid,
    };
};

const bidOf = (g: GameDoc): number | 'pass' => {
    const a = nextBotAction(g);
    expect(a?.type).toBe('BID');
    return (a as { type: 'BID'; bid: number | 'pass' }).bid;
};

describe('bidding: partner protection', () => {
    it('never bids when partner holds the high bid and both opponents passed — even with a monster', () => {
        for (const style of ['basic', 'aggressive', 'cautious'] as BotStyle[]) {
            const g = biddingState({
                turn: 'A1', hand: MONSTER, style,
                bids: { A2: 80, B1: 'pass', B2: 'pass' }, highBid: 80,
            });
            expect(bidOf(g)).toBe('pass');
        }
    });

    it('cautious never outbids partner, even in a live auction', () => {
        const g = biddingState({
            turn: 'A1', hand: MONSTER, style: 'cautious',
            bids: { A2: 80, B1: 'pass' }, highBid: 80, // B2 still alive
        });
        expect(bidOf(g)).toBe('pass');
    });

    it('basic leaves a middling hand to the partner in a live auction', () => {
        const g = biddingState({
            turn: 'A1', hand: MIDDLING, style: 'basic',
            bids: { A2: 80, B1: 'pass' }, highBid: 80,
        });
        expect(bidOf(g)).toBe('pass');
    });

    it('aggressive takes it from partner in a live auction with a monster', () => {
        const g = biddingState({
            turn: 'A1', hand: MONSTER, style: 'aggressive',
            bids: { A2: 80, B1: 'pass' }, highBid: 80,
        });
        expect(bidOf(g)).toBe(85);
    });

    it('competes normally when an opponent holds the high bid', () => {
        const g = biddingState({
            turn: 'A1', hand: MONSTER, style: 'basic',
            bids: { B1: 80 }, highBid: 80,
        });
        expect(bidOf(g)).toBe(85);
    });

    it('passes junk instead of bidding', () => {
        const g = biddingState({
            turn: 'A1', hand: JUNK, style: 'basic',
            bids: {}, highBid: null,
        });
        expect(bidOf(g)).toBe('pass');
    });

    it('bids 65 when forced (other three passed)', () => {
        const g = biddingState({
            turn: 'B2', hand: JUNK, style: 'cautious',
            bids: { A1: 'pass', B1: 'pass', A2: 'pass' }, highBid: null,
        });
        expect(bidOf(g)).toBe(65);
    });
});

describe('hand evaluation', () => {
    it('ranks monster > middling > junk', () => {
        expect(estimateTricks(MONSTER)).toBeGreaterThan(estimateTricks(MIDDLING));
        expect(estimateTricks(MIDDLING)).toBeGreaterThan(estimateTricks(JUNK));
    });

    it('go-down keeps trump and counters, and voids a short side suit when it can ruff', () => {
        const hand13: Card[] = [
            c('Red', 14), c('Red', 13), c('Red', 12), c('Red', 11), c('Red', 9), c('Red', 8),
            c('Yellow', 6), c('Yellow', 7),
            c('Black', 14), c('Black', 12),
            c('Green', 9), c('Green', 8), c('Green', 6),
        ];
        const gd = chooseGoDown(hand13, 'Red');
        expect(gd).toHaveLength(4);
        expect(gd.every((card) => card.suit !== 'Red')).toBe(true);
        expect(gd.every((card) => getCardPoints(card) === 0)).toBe(true);
        // some side suit got emptied entirely for ruffing power
        const keep = hand13.filter((card) => !gd.some((d) => d.suit === card.suit && d.number === card.number));
        const keptSuits = new Set(keep.map((card) => card.suit));
        expect(keptSuits.size).toBeLessThan(4);
    });
});

// ---------------------------------------------------------------------------
// Calibration: full bot-vs-bot games, distribution-level assertions.
// ---------------------------------------------------------------------------

const playGames = (n: number, styles: Record<Seat, BotStyle>) => {
    const bids: number[] = [];
    let sets = 0;
    let teamLockedOverbids = 0;
    for (let i = 0; i < n; i++) {
        let g = createGameDoc({ id: `cal-${i}`, joinCode: 'CALT', host, now: 1 });
        g = applyAction(g, { type: 'START_GAME' });
        for (const s of SEATS) {
            (g.seats[s] as SeatInfo) = { kind: 'bot', name: `Bot ${s}`, botStyle: styles[s] };
        }
        let safety = 30000;
        while (g.status === 'active' && safety-- > 0) {
            if (g.phase === 'hand_done') {
                g = applyAction(g, { type: 'NEXT_HAND' });
                continue;
            }
            const action = nextBotAction(g);
            if (!action) throw new Error(`simulation wedged in phase ${g.phase}`);
            if (action.type === 'BID' && action.bid !== 'pass' && g.highBid !== null) {
                const partner = SEATS[(SEATS.indexOf(action.seat) + 2) % 4];
                const opps = SEATS.filter((s) => s.charAt(0) !== action.seat.charAt(0));
                if (g.bids[partner] === g.highBid && opps.every((s) => g.bids[s] === 'pass')) {
                    teamLockedOverbids++;
                }
            }
            g = applyAction(g, action);
        }
        if (safety <= 0) throw new Error('simulation did not terminate');
        for (const h of g.handHistory) {
            bids.push(h.bid);
            if (h.wentSet) sets++;
        }
    }
    return { bids, sets, teamLockedOverbids };
};

describe('bidding calibration (statistical)', () => {
    it('winning bids center in the 90s with rare tails, and nobody raises a locked team contract', () => {
        const { bids, sets, teamLockedOverbids } = playGames(40, {
            A1: 'basic', B1: 'aggressive', A2: 'cautious', B2: 'basic',
        });
        expect(bids.length).toBeGreaterThan(200);

        // the family's #2 complaint: this must simply never happen
        expect(teamLockedOverbids).toBe(0);

        const mean = bids.reduce((a, b) => a + b, 0) / bids.length;
        const share = (lo: number, hi: number) =>
            bids.filter((b) => b >= lo && b <= hi).length / bids.length;

        expect(mean).toBeGreaterThan(87);
        expect(mean).toBeLessThan(101);
        expect(share(90, 105)).toBeGreaterThan(0.5);   // the meaty middle
        expect(share(110, 120)).toBeLessThan(0.10);    // rare
        expect(share(115, 120)).toBeLessThan(0.04);    // very rare
        expect(share(65, 70)).toBeLessThan(0.10);      // forced/steal bids only

        // going set happens (it's Rook) but not most of the time
        expect(sets / bids.length).toBeLessThan(0.5);
        expect(sets / bids.length).toBeGreaterThan(0.1);
    }, 120000);
});
