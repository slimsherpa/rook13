// Observation -> feature vectors for the trained AlphaRook value network.
//
// A bit-parity port of ml/alpharook/encoder.py — the frozen gen7/gen8 weights
// were trained against that exact layout, so every index and normalization
// here must match it. neural.test.ts proves it does by replaying a full
// Python-traced game and comparing q values decision by decision.
//
// Cards/suits/seats are the training stack's integer encodings:
// suit 0=Red 1=Yellow 2=Black 3=Green; card = suit*10 + (number-5);
// seats 0..3 = A1,B1,A2,B2. Everything is seat-relative (0 = me, 2 = partner)
// so one network plays all four chairs.

import { Card, Seat, Suit, SEATS, SUITS, getCardPoints } from '../game/types';
import { estimateTricksAs } from '../game/bots';
import { Observation, knownVoids, handSizes } from './observation';

// decision types
export const D_BID = 0;
export const D_DISCARD = 1;
export const D_TRUMP = 2;
export const D_PLAY = 3;

/** bid sentinel in the training stack ('pass' in TS); real bids are >= 65 */
export const PASS = 0;

export const ACTION_DIM = 50; // [type onehot 4, is_pass, bid/120, card onehot 40, suit onehot 4]
export const STATE_DIM = 479; // see the layout walkthrough in encoder.py

export const suitToInt = (s: Suit): number => SUITS.indexOf(s);
export const cardToInt = (c: Card): number => suitToInt(c.suit) * 10 + (c.number - 5);
export const intToCard = (i: number): Card => ({ suit: SUITS[Math.floor(i / 10)], number: (i % 10) + 5 });
export const seatToInt = (s: Seat): number => SEATS.indexOf(s);

const f32 = Math.fround; // numpy stores into float32; round the same way

/** Public auction context the encoder needs beyond the Observation. */
export interface AuctionContext {
    mustBid: boolean;
    minNextBid: number | null;
}

export const encodeState = (
    o: Observation,
    picks: number[],               // my pending go-down picks, as card ints
    decisionType: number,
    ctx: AuctionContext,
    trumpIntent: number | null = null, // my OWN trump plan during widow decisions
): Float32Array => {
    const me = seatToInt(o.seat);
    const rel = (s: Seat): number => (((seatToInt(s) - me) % 4) + 4) % 4;
    const x = new Float32Array(STATE_DIM);
    let base = 0;

    // my hand
    for (const c of o.hand) x[cardToInt(c)] = 1.0;
    base += 40;

    // my go-down (bid winner only) plus pending discard picks
    for (const c of o.myGoDown ?? []) x[base + cardToInt(c)] = 1.0;
    for (const c of picks) x[base + c] = 1.0;
    base += 40;

    // cards played this hand, by relative seat
    for (const t of o.completedTricks) {
        for (const p of t.plays) x[base + rel(p.seat) * 40 + cardToInt(p.card)] = 1.0;
    }
    for (const p of o.trickPlays) x[base + rel(p.seat) * 40 + cardToInt(p.card)] = 1.0;
    base += 160;

    // current trick only, by relative seat
    for (const p of o.trickPlays) x[base + rel(p.seat) * 40 + cardToInt(p.card)] = 1.0;
    base += 160;

    // trick leader (relative) or none
    if (o.trickLeader !== null) x[base + rel(o.trickLeader)] = 1.0;
    else x[base + 4] = 1.0;
    base += 5;

    x[base] = f32(o.trickPlays.length / 4.0);
    base += 1;

    // trump (declared, or my own intent while shaping the go-down)
    const knownTrump = o.trump !== null ? suitToInt(o.trump) : trumpIntent;
    if (knownTrump !== null) x[base + knownTrump] = 1.0;
    else x[base + 4] = 1.0;
    base += 5;

    x[base + decisionType] = 1.0;
    base += 4;

    // bids per relative seat: [silent, passed, value/120]
    for (const s of SEATS) {
        const r = rel(s);
        const b = o.bids[s];
        if (b === undefined) x[base + r * 3 + 0] = 1.0;
        else if (b === 'pass') x[base + r * 3 + 1] = 1.0;
        else x[base + r * 3 + 2] = f32(b / 120.0);
    }
    base += 12;

    x[base] = f32((o.highBid ?? 0) / 120.0);
    base += 1;
    x[base] = ctx.mustBid ? 1.0 : 0.0;
    base += 1;
    x[base] = f32((ctx.minNextBid ?? 0) / 120.0);
    base += 1;

    if (o.bidWinner !== null) x[base + rel(o.bidWinner)] = 1.0;
    else x[base + 4] = 1.0;
    base += 5;

    const myTeam = o.seat.charAt(0) as 'A' | 'B';
    const oppTeam = myTeam === 'A' ? 'B' : 'A';
    x[base] = o.bidWinner !== null && o.bidWinner.charAt(0) === myTeam ? 1.0 : 0.0;
    base += 1;

    // known voids (relative seat x suit)
    const voids = knownVoids(o);
    for (const s of SEATS) {
        voids[s].forEach((suit) => { x[base + rel(s) * 4 + suitToInt(suit)] = 1.0; });
    }
    base += 16;

    const sizes = handSizes(o);
    for (const s of SEATS) x[base + rel(s)] = f32(sizes[s] / 9.0);
    base += 4;

    x[base] = f32(o.tricksWon[myTeam] / 9.0);
    x[base + 1] = f32(o.tricksWon[oppTeam] / 9.0);
    base += 2;
    x[base] = f32(o.pointsTaken[myTeam] / 100.0);
    x[base + 1] = f32(o.pointsTaken[oppTeam] / 100.0);
    base += 2;

    // game context: the reason the net trained on full games (-250..500)
    const mine = o.scores[myTeam];
    const theirs = o.scores[oppTeam];
    x[base] = f32(mine / 500.0);
    x[base + 1] = f32(theirs / 500.0);
    x[base + 2] = f32((500 - mine) / 750.0);
    x[base + 3] = f32((500 - theirs) / 750.0);
    x[base + 4] = f32((mine + 250) / 750.0);
    x[base + 5] = f32((theirs + 250) / 750.0);
    x[base + 6] = f32(Math.min(o.handNumber, 20) / 20.0);
    base += 7;

    x[base] = f32(o.completedTricks.length / 9.0);
    base += 1;

    // own-hand strength: suit lengths, per-suit trick estimates, best
    // estimate, hand points, counter count — all from MY cards only
    const ests = SUITS.map((s) => estimateTricksAs(o.hand, s));
    for (let s = 0; s < 4; s++) {
        x[base + s] = f32(o.hand.filter((c) => suitToInt(c.suit) === s).length / 9.0);
    }
    base += 4;
    for (let s = 0; s < 4; s++) x[base + s] = f32(ests[s] / 9.0);
    base += 4;
    x[base] = f32(Math.max(...ests) / 9.0);
    x[base + 1] = f32(o.hand.reduce((sum, c) => sum + getCardPoints(c), 0) / 40.0);
    x[base + 2] = f32(o.hand.filter((c) => getCardPoints(c) > 0).length / 9.0);
    base += 3;

    if (base !== STATE_DIM) throw new Error(`encoder layout drifted: ${base} != ${STATE_DIM}`);
    return x;
};

/**
 * action: for D_BID an int (PASS or 65..120); for D_DISCARD / D_PLAY a card
 * int; for D_TRUMP a suit int.
 */
export const encodeAction = (decisionType: number, action: number): Float32Array => {
    const a = new Float32Array(ACTION_DIM);
    a[decisionType] = 1.0;
    if (decisionType === D_BID) {
        if (action === PASS) a[4] = 1.0;
        else a[5] = f32(action / 120.0);
    } else if (decisionType === D_DISCARD || decisionType === D_PLAY) {
        a[6 + action] = 1.0;
        a[46 + Math.floor(action / 10)] = 1.0;
    } else if (decisionType === D_TRUMP) {
        a[46 + action] = 1.0;
    }
    return a;
};
