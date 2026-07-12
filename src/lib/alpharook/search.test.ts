// gen11 search integrity, mirroring ml/tests/test_search.py:
//  1. A net rollout over the TRUE hidden world plays out exactly like the
//     real engine fed the same cards (materialize + applyPlayFast + netCard
//     are faithful), and scoreHand matches the engine's hand accounting.
//  2. Search is blind to hidden cards: same observation + same rng stream =
//     same card, no matter how the unseen cards are actually distributed.
//  3. Search picks legal cards and runs at the shipped config.

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { GameDoc, Card, Seat, SEATS, Team, sameCard } from '../game/types';
import { createGameDoc, applyAction } from '../game/engine';
import { nextBotAction } from '../game/bots';
import { observe } from './observation';
import { legalFromObservation } from './pimc';
import { materialize, scoreHand, applyPlayFast } from './rollout';
import { World } from './determinize';
import { netCard, chooseSearchCard, GEN11_SEARCH } from './search';
import { parseWeights, QNetWeights } from './qnet';

const ROOT = path.resolve(__dirname, '../../..');
const gen10: QNetWeights = (() => {
    const buf = fs.readFileSync(path.join(ROOT, 'public/models', 'gen10.bin'));
    return parseWeights(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
})();

/** Deterministic rng for reproducible world sampling (mulberry32). */
const seededRand = (seed: number): (() => number) => {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

const host = { uid: 'host', name: 'Host' };

const runUntil = (id: string, stop: (g: GameDoc) => boolean): GameDoc => {
    let g = createGameDoc({ id, joinCode: 'GXI', host, now: 1 });
    g = applyAction(g, { type: 'START_GAME' });
    for (const s of SEATS) {
        (g.seats[s] as GameDoc['seats'][Seat]) = { kind: 'bot', name: s, botStyle: 'basic' };
    }
    let safety = 30000;
    while (safety-- > 0) {
        if (stop(g)) return g;
        if (g.status !== 'active') throw new Error('game ended before stop');
        if (g.phase === 'hand_done') { g = applyAction(g, { type: 'NEXT_HAND' }); continue; }
        g = applyAction(g, nextBotAction(g)!);
    }
    throw new Error('runUntil never hit stop');
};

const lateTrickState = (id: string, tricks: number): GameDoc =>
    runUntil(id, (g) => g.phase === 'playing'
        && g.completedTricks.length >= tricks && g.turn !== null);

/** The REAL hidden state as a World (cheating on purpose — it's the oracle). */
const trueWorld = (g: GameDoc): World => ({
    hands: {
        A1: [...g.hands.A1], B1: [...g.hands.B1],
        A2: [...g.hands.A2], B2: [...g.hands.B2],
    },
    goDown: [...g.goDown],
});

describe('net rollouts are faithful to the real engine', () => {
    it('a net playout over the true world matches the engine card for card', () => {
        for (let i = 0; i < 6; i++) {
            let real = lateTrickState(`oracle-${i}`, i % 4);
            const seat = real.turn!;
            const sim = materialize(observe(real, seat), trueWorld(real));
            const handNo = real.handNumber;

            // step the SIM with the rollout policy, feeding the same card to
            // the REAL engine each time; both must accept every move
            let safety = 40;
            while (sim.completedTricks.length < 9 && safety-- > 0) {
                const actor = sim.turn!;
                expect(actor).toBe(real.turn);
                const card = netCard(sim, gen10);
                applyPlayFast(sim, actor, card);
                real = applyAction(real, { type: 'PLAY_CARD', seat: actor, card });
            }
            expect(sim.completedTricks.length).toBe(9);

            // engine's hand accounting vs the rollout's scoreHand
            const h = real.handHistory.find((x) => x.handNumber === handNo)!;
            const hs = scoreHand(sim);
            expect(hs.A).toBe(h.handScore.A);
            expect(hs.B).toBe(h.handScore.B);
        }
    }, 60000);
});

describe('search is blind to hidden cards', () => {
    it('scrambling unseen zones never changes the chosen card', () => {
        for (let i = 0; i < 3; i++) {
            const g = lateTrickState(`blind-${i}`, GEN11_SEARCH.minTrick);
            const seat = g.turn!;

            const first = chooseSearchCard(g, gen10, GEN11_SEARCH, seededRand(99 + i));

            // redistribute every card the observer cannot see (other hands +
            // the hidden go-down), preserving zone sizes
            const zones = SEATS.filter((s) => s !== seat);
            const pool: Card[] = zones.flatMap((s) => g.hands[s]);
            const gdHidden = g.bidWinner !== seat;
            if (gdHidden) pool.push(...g.goDown);
            const rand = seededRand(1234 + i);
            for (let j = pool.length - 1; j > 0; j--) {
                const k = Math.floor(rand() * (j + 1));
                [pool[j], pool[k]] = [pool[k], pool[j]];
            }
            let off = 0;
            for (const s of zones) {
                const n = g.hands[s].length;
                g.hands[s] = pool.slice(off, off + n);
                off += n;
            }
            if (gdHidden) g.goDown = pool.slice(off);

            const second = chooseSearchCard(g, gen10, GEN11_SEARCH, seededRand(99 + i));
            expect(sameCard(first.card, second.card)).toBe(true);
            expect(second.scores).toEqual(first.scores);
        }
    }, 60000);
});

describe('shipped gen11 config', () => {
    it('always picks a legal card and reports coherent telemetry', () => {
        for (let i = 0; i < 4; i++) {
            const g = lateTrickState(`legal-${i}`, GEN11_SEARCH.minTrick);
            const legal = legalFromObservation(observe(g, g.turn!));
            const d = chooseSearchCard(g, gen10, GEN11_SEARCH, seededRand(7 + i));
            expect(legal.some((c) => sameCard(c, d.card))).toBe(true);
            expect(d.scores.length).toBe(legal.length);
            expect(d.prior.length).toBe(legal.length);
            const best = d.scores.indexOf(Math.max(...d.scores));
            expect(sameCard(legal[best], d.card)).toBe(true);
        }
    }, 60000);
});
