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
    for (const s of SEATS) {
        (g.seats[s] as SeatInfo) = { kind: 'bot', name: `Bot ${s}`, botStyle: 'basic' };
    }
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

    it('jump-bids a statement over an opponent instead of creeping', () => {
        const g = biddingState({
            turn: 'A1', hand: MONSTER, style: 'basic',
            bids: { B1: 80 }, highBid: 80,
        });
        expect(bidOf(g)).toBe(105); // statement bid, not floor-creeping 85
    });

    it('creeps in minimum steps with a hand only modestly above the price', () => {
        const g = biddingState({
            turn: 'A1', hand: MIDDLING, style: 'basic',
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

    it('never puts trump in the go-down', () => {
        // junk trump is still trump — family law
        const hand13: Card[] = [
            c('Red', 9), c('Red', 8), c('Red', 7), c('Red', 6), c('Red', 5),
            c('Yellow', 14), c('Yellow', 13), c('Yellow', 12),
            c('Black', 14), c('Black', 13),
            c('Green', 14), c('Green', 13), c('Green', 12),
        ];
        const gd = chooseGoDown(hand13, 'Red');
        expect(gd.every((card) => card.suit !== 'Red')).toBe(true);
    });

    it('names its longest suit trump even when a shorter suit has more honors', () => {
        let g = createGameDoc({ id: 'trump-test', joinCode: 'TRMP', host, now: 1 });
        g = applyAction(g, { type: 'START_GAME' });
        for (const s of SEATS) {
            (g.seats[s] as SeatInfo) = { kind: 'bot', name: `Bot ${s}`, botStyle: 'basic' };
        }
        while (g.phase === 'dealing' || g.phase === 'redeal') {
            g = applyAction(g, nextBotAction(g)!);
        }
        const hand: Card[] = [
            c('Red', 9), c('Red', 8), c('Red', 7), c('Red', 6), c('Red', 5),
            c('Yellow', 14), c('Yellow', 13), c('Yellow', 12),
            c('Black', 6),
        ];
        const frozen: GameDoc = {
            ...g,
            phase: 'trump',
            turn: 'A1',
            bidWinner: 'A1',
            highBid: 100,
            hands: { ...g.hands, A1: hand },
        };
        const a = nextBotAction(frozen);
        expect(a).toEqual({ type: 'SELECT_TRUMP', seat: 'A1', suit: 'Red' });
    });

    it('go-down banks a loose counter for the last trick', () => {
        // family rule, confirmed by A/B sims: the go-down is a bank — a loose
        // 10 in a short side suit goes down, not into enemy hands
        const hand13: Card[] = [
            c('Red', 14), c('Red', 13), c('Red', 12), c('Red', 11), c('Red', 9), c('Red', 8),
            c('Yellow', 10), c('Yellow', 6),
            c('Black', 14), c('Black', 12),
            c('Green', 9), c('Green', 8), c('Green', 6),
        ];
        const gd = chooseGoDown(hand13, 'Red');
        expect(gd.some((card) => card.suit === 'Yellow' && card.number === 10)).toBe(true);
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
// Trick play: personality-driven table manners.
// ---------------------------------------------------------------------------

/** A game frozen mid-trick. Only the acting seat's hand matters. */
const playingState = (opts: {
    turn: Seat;
    hand: Card[];
    style: BotStyle;
    trump: Suit;
    trickLeader: Seat;
    trickPlays: { seat: Seat; card: Card }[];
    completedTricks?: GameDoc['completedTricks'];
}): GameDoc => {
    let g = createGameDoc({ id: 'play-test', joinCode: 'PLYT', host, now: 1 });
    g = applyAction(g, { type: 'START_GAME' });
    for (const s of SEATS) {
        (g.seats[s] as SeatInfo) = { kind: 'bot', name: `Bot ${s}`, botStyle: 'basic' };
    }
    while (g.phase === 'dealing' || g.phase === 'redeal') {
        g = applyAction(g, nextBotAction(g)!);
    }
    return {
        ...g,
        phase: 'playing',
        turn: opts.turn,
        hands: { ...g.hands, [opts.turn]: opts.hand },
        seats: { ...g.seats, [opts.turn]: { kind: 'bot' as const, name: 'Bot', botStyle: opts.style } },
        bidWinner: 'B1',
        highBid: 80,
        trump: opts.trump,
        trickLeader: opts.trickLeader,
        trickPlays: opts.trickPlays,
        completedTricks: opts.completedTricks ?? [],
    };
};

const cardPlayed = (g: GameDoc): Card => {
    const a = nextBotAction(g);
    expect(a?.type).toBe('PLAY_CARD');
    return (a as { type: 'PLAY_CARD'; card: Card }).card;
};

describe('trick play: feeding and ruffing', () => {
    it('feeds a counter to a partner whose boss card is likely to hold', () => {
        // A2 led the Green 14 (boss), B2 followed low; A1 acts 3rd with B1
        // behind and no evidence B1 is void — feed the 10, not the cheap 7
        const g = playingState({
            turn: 'A1', style: 'basic', trump: 'Red', trickLeader: 'A2',
            trickPlays: [
                { seat: 'A2', card: c('Green', 14) },
                { seat: 'B2', card: c('Green', 6) },
            ],
            hand: [c('Green', 10), c('Green', 7), c('Black', 8), c('Yellow', 9)],
        });
        expect(cardPlayed(g)).toEqual(c('Green', 10));
    });

    it('holds the counter back when the opponent behind is known void', () => {
        // same spot, but B1 failed to follow Green earlier — they can ruff
        const g = playingState({
            turn: 'A1', style: 'basic', trump: 'Red', trickLeader: 'A2',
            trickPlays: [
                { seat: 'A2', card: c('Green', 14) },
                { seat: 'B2', card: c('Green', 6) },
            ],
            hand: [c('Green', 10), c('Green', 7), c('Black', 8), c('Yellow', 9)],
            completedTricks: [{
                leader: 'A2',
                plays: [
                    { seat: 'A2', card: c('Green', 8) },
                    { seat: 'B2', card: c('Green', 9) },
                    { seat: 'A1', card: c('Green', 11) },
                    { seat: 'B1', card: c('Black', 6) }, // <- void in Green
                ],
                winner: 'A1',
                points: 0,
            }],
        });
        expect(cardPlayed(g)).toEqual(c('Green', 7));
    });

    it('cautious ruffs in early when the lead suit still has counters to catch', () => {
        // no points on the table yet, but Yellow's 5/10/13 are all unseen —
        // ruffing low here is how you catch count (family rule)
        const g = playingState({
            turn: 'A1', style: 'cautious', trump: 'Red', trickLeader: 'B1',
            trickPlays: [{ seat: 'B1', card: c('Yellow', 7) }],
            hand: [c('Red', 6), c('Black', 8), c('Green', 9), c('Black', 11)],
        });
        expect(cardPlayed(g)).toEqual(c('Red', 6));
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
