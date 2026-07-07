// AlphaRook foundation tests. The non-negotiables:
//  1. An Observation can never leak hidden cards (rule integrity).
//  2. Sampled worlds are always consistent with what was legally seen.
//  3. The fast rollout scores hands identically to the real engine.
//  4. PIMC picks legal cards and full matches complete.

import { describe, it, expect } from 'vitest';
import { GameDoc, Card, Seat, SEATS, cardKey, sameCard, teamOf } from '../game/types';
import { createGameDoc, applyAction } from '../game/engine';
import { nextBotAction } from '../game/bots';
import { observe, unseenCards, knownVoids, handSizes } from './observation';
import { nextAgentAction } from './agent';
import { sampleWorld } from './determinize';
import { materialize, playOut, scoreHand, applyPlayFast } from './rollout';
import { choosePIMCCard, legalFromObservation } from './pimc';

const host = { uid: 'host', name: 'Host' };

/** Drive a fresh all-bot game until `stop` says so; returns the live doc. */
const runUntil = (id: string, stop: (g: GameDoc) => boolean): GameDoc => {
    let g = createGameDoc({ id, joinCode: 'ALFA', host, now: 1 });
    g = applyAction(g, { type: 'START_GAME' });
    for (const s of SEATS) {
        (g.seats[s] as GameDoc['seats'][Seat]) = { kind: 'bot', name: s, botStyle: 'basic' };
    }
    let safety = 30000;
    while (safety-- > 0) {
        if (stop(g)) return g;
        if (g.status !== 'active') throw new Error('game ended before stop condition');
        if (g.phase === 'hand_done') { g = applyAction(g, { type: 'NEXT_HAND' }); continue; }
        g = applyAction(g, nextBotAction(g)!);
    }
    throw new Error('runUntil never hit stop condition');
};

/** A state mid-trick (some cards played in the current trick). */
const midTrickState = (id: string): GameDoc =>
    runUntil(id, (g) => g.phase === 'playing' && g.trickPlays.length >= 1 && g.completedTricks.length >= 2);

describe('observation: rule integrity (no leaks)', () => {
    it('never contains cards from hidden zones, across many game states', () => {
        for (let i = 0; i < 10; i++) {
            const g = midTrickState(`leak-${i}`);
            for (const seat of SEATS) {
                const o = observe(g, seat);

                // hidden zones right now: everyone else's hand, plus the
                // go-down unless this seat took the bid
                const hidden = new Set<string>();
                for (const s of SEATS) {
                    if (s !== seat) for (const c of g.hands[s]) hidden.add(cardKey(c));
                }
                if (g.bidWinner !== seat) for (const c of g.goDown) hidden.add(cardKey(c));

                // every card the observation mentions, anywhere
                const mentioned: Card[] = [
                    ...o.hand,
                    ...(o.myGoDown ?? []),
                    ...o.trickPlays.map((p) => p.card),
                    ...o.completedTricks.flatMap((t) => t.plays.map((p) => p.card)),
                ];
                for (const c of mentioned) {
                    expect(hidden.has(cardKey(c)), `${seat} observation leaked ${cardKey(c)}`).toBe(false);
                }

                // and the observer genuinely cannot locate the hidden cards
                const unseen = new Set(unseenCards(o).map(cardKey));
                for (const key of Array.from(hidden)) {
                    expect(unseen.has(key), `${seat} should not know where ${key} is`).toBe(true);
                }
            }
        }
    });

    it('shows the go-down only to the bid winner', () => {
        const g = midTrickState('godown-vis');
        for (const seat of SEATS) {
            const o = observe(g, seat);
            if (seat === g.bidWinner) {
                expect(o.myGoDown).toEqual(g.goDown);
            } else {
                expect(o.myGoDown).toBeNull();
            }
        }
    });
});

describe('determinize: consistent worlds', () => {
    it('sampled worlds respect sizes, voids, and known cards', () => {
        for (let i = 0; i < 5; i++) {
            const g = midTrickState(`world-${i}`);
            for (const seat of SEATS) {
                const o = observe(g, seat);
                const sizes = handSizes(o);
                const voids = knownVoids(o);
                for (let k = 0; k < 20; k++) {
                    const w = sampleWorld(o);
                    // my own cards are exactly preserved
                    expect(w.hands[seat]).toEqual(o.hand);
                    expect(w.goDown).toHaveLength(4);
                    const all: Card[] = [...w.goDown];
                    for (const s of SEATS) {
                        expect(w.hands[s], `${s} hand size`).toHaveLength(sizes[s]);
                        all.push(...w.hands[s]);
                        if (s === seat) continue;
                        for (const c of w.hands[s]) {
                            expect(voids[s].has(c.suit), `${s} was dealt a suit they showed void in`).toBe(false);
                        }
                    }
                    // no duplicates across the whole world
                    expect(new Set(all.map(cardKey)).size).toBe(all.length);
                }
            }
        }
    });
});

describe('rollout: matches the real engine', () => {
    it('scores hands identically to the engine given the true world', () => {
        for (let i = 0; i < 12; i++) {
            // snapshot the exact start of a hand's trick play
            const g = runUntil(`roll-${i}`, (s) =>
                s.phase === 'playing' && s.completedTricks.length === 0 && s.trickPlays.length === 0);
            const snapshot = structuredClone(g);

            // fast path: materialize with the TRUE hidden state and play out
            const o = observe(snapshot, snapshot.turn!);
            const world = {
                hands: structuredClone(snapshot.hands),
                goDown: structuredClone(snapshot.goDown),
            };
            const fast = materialize(o, world);
            playOut(fast);

            // real path: let the engine finish the same hand
            let real = g;
            const handNo = real.handNumber;
            let safety = 200;
            while (real.status === 'active' && real.phase === 'playing' && real.handNumber === handNo && safety-- > 0) {
                real = applyAction(real, nextBotAction(real)!);
            }
            const h = real.handHistory[real.handHistory.length - 1];
            expect(h.handNumber).toBe(handNo);
            expect(fast.pointsTaken).toEqual(h.pointsTaken);
            expect(scoreHand(fast)).toEqual(h.handScore);
            expect(fast.tricksWon).toEqual(h.tricksWon);
        }
    });
});

describe('PIMC v0', () => {
    it('always picks a legal card', () => {
        for (let i = 0; i < 5; i++) {
            const g = midTrickState(`pimc-legal-${i}`);
            const seat = g.turn!;
            const o = observe(g, seat);
            const card = choosePIMCCard(o, { samples: 4 });
            expect(legalFromObservation(o).some((c) => sameCard(c, card))).toBe(true);
        }
    });

    it('plays a full game as one team without breaking the engine', () => {
        let g = createGameDoc({ id: 'pimc-match', joinCode: 'ALFA', host, now: 1 });
        g = applyAction(g, { type: 'START_GAME' });
        for (const s of SEATS) {
            (g.seats[s] as GameDoc['seats'][Seat]) = { kind: 'bot', name: s, botStyle: 'basic' };
        }
        let safety = 30000;
        while (g.status === 'active' && safety-- > 0) {
            if (g.phase === 'hand_done') { g = applyAction(g, { type: 'NEXT_HAND' }); continue; }
            const seat = g.turn;
            if (g.phase === 'playing' && seat && teamOf(seat) === 'A') {
                const card = choosePIMCCard(observe(g, seat), { samples: 4 });
                g = applyAction(g, { type: 'PLAY_CARD', seat, card });
                continue;
            }
            g = applyAction(g, nextBotAction(g)!);
        }
        expect(g.status).toBe('completed');
        expect(g.winner).not.toBeNull();
    }, 120000);

    it("the agent dispatcher drives 'alpharook' seats through a full game", () => {
        let g = createGameDoc({ id: 'agent-match', joinCode: 'ALFA', host, now: 1 });
        g = applyAction(g, { type: 'START_GAME' });
        for (const s of SEATS) {
            (g.seats[s] as GameDoc['seats'][Seat]) = {
                kind: 'bot', name: s, botStyle: teamOf(s) === 'A' ? 'alpharook' : 'basic',
            };
        }
        let safety = 30000;
        while (g.status === 'active' && safety-- > 0) {
            if (g.phase === 'hand_done') { g = applyAction(g, { type: 'NEXT_HAND' }); continue; }
            g = applyAction(g, nextAgentAction(g)!);
        }
        expect(g.status).toBe('completed');
        expect(g.winner).not.toBeNull();
    }, 120000);
});
