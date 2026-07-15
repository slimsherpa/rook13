// gen16 parity + integrity, mirroring ml/tests/test_belief_search.py:
//  1. beliefForward reproduces the Python training stack's logits on golden
//     vectors — the RNG-free proof the browser runs gen15's actual organ.
//  2. beliefPosterior is a proper distribution per card.
//  3. sampleWorldWeighted obeys the exact contract of sampleWorld
//     (partition, sizes, voids, own go-down) under adversarial posteriors,
//     and actually FOLLOWS the posterior when it speaks.
//  4. Belief-guided search is blind to the true hidden cards.
//
// Regenerate fixtures: cd ml && ~/torch-env/bin/python -m alpharook.export_web
//   --gens gen13 --belief-gen gen15

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { GameDoc, Card, Seat, SEATS, sameCard } from '../game/types';
import { createGameDoc, applyAction } from '../game/engine';
import { nextBotAction } from '../game/bots';
import { observe, unseenCards, knownVoids, handSizes } from './observation';
import { sampleWorldWeighted } from './determinize';
import { chooseSearchCard, beliefPosterior, GEN16_SEARCH } from './search';
import { parseWeights, beliefForward, QNetWeights } from './qnet';
import { cardToInt, encodeStateFor, D_PLAY } from './encoder';
import { legalFromObservation } from './pimc';
import { minNextBid, mustBid } from '../game/engine';

const ROOT = path.resolve(__dirname, '../../..');

const loadBin = (file: string): QNetWeights => {
    const buf = fs.readFileSync(path.join(ROOT, 'public/models', file));
    return parseWeights(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};
const belief = loadBin('gen15belief.bin');
const gen13 = loadBin('gen13.bin');

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

const playingState = (id: string, tricks: number): GameDoc =>
    runUntil(id, (g) => g.phase === 'playing'
        && g.completedTricks.length >= tricks && g.turn !== null);

const randomPosterior = (rand: () => number): number[][] =>
    Array.from({ length: 40 }, () => {
        const row = [0, 1, 2, 3].map(() => rand() ** 3 + 1e-9);
        const z = row.reduce((a, b) => a + b, 0);
        return row.map((v) => v / z);
    });

interface BeliefGolden {
    states: number[][];
    actions: number[][];
    logits: number[][];
}

describe('beliefForward parity with the Python training stack', () => {
    it('reproduces gen15 belief logits on golden vectors', () => {
        const fix = JSON.parse(fs.readFileSync(
            path.join(__dirname, '__fixtures__', 'belief.golden.gen15.json'),
            'utf8')) as BeliefGolden;
        for (let i = 0; i < fix.states.length; i++) {
            const out = beliefForward(belief,
                Float32Array.from(fix.states[i]),
                Float32Array.from(fix.actions[i]));
            expect(out.length).toBe(160);
            for (let j = 0; j < 160; j++) {
                expect(Math.abs(out[j] - fix.logits[i][j])).toBeLessThan(1e-2);
            }
        }
    });

    it('beliefPosterior rows are proper distributions', () => {
        const g = playingState('posterior-0', 2);
        const seat = g.turn!;
        const o = observe(g, seat);
        const legal = legalFromObservation(o);
        const state = encodeStateFor(gen13, o, [], D_PLAY,
            { mustBid: mustBid(g), minNextBid: minNextBid(g) });
        const p = beliefPosterior(belief, state, legal.map(cardToInt), 0.5);
        expect(p.length).toBe(40);
        for (const row of p) {
            const z = row.reduce((a, b) => a + b, 0);
            expect(Math.abs(z - 1)).toBeLessThan(1e-6);
            for (const v of row) expect(v).toBeGreaterThanOrEqual(0);
        }
    });
});

describe('sampleWorldWeighted honors the constraint contract', () => {
    it('partition, hand sizes, voids and own go-down all hold under adversarial posteriors', () => {
        for (let i = 0; i < 6; i++) {
            const g = playingState(`weighted-${i}`, i % 5);
            const seat = g.turn!;
            const o = observe(g, seat);
            const rand = seededRand(7 + i);
            const world = sampleWorldWeighted(o, randomPosterior(rand), rand);

            expect(world.hands[seat]).toEqual(o.hand);
            const sizes = handSizes(o);
            for (const s of SEATS) expect(world.hands[s].length).toBe(sizes[s]);
            if (o.myGoDown) expect(world.goDown).toEqual(o.myGoDown);

            // the world + everything already seen partitions all 40 cards
            const played = [
                ...g.completedTricks.flatMap((t) => t.plays.map((p) => p.card)),
                ...g.trickPlays.map((p) => p.card),
            ];
            const all = [
                ...SEATS.flatMap((s) => world.hands[s]),
                ...world.goDown, ...played,
            ].map(cardToInt).sort((a, b) => a - b);
            expect(all).toEqual(Array.from({ length: 40 }, (_, k) => k));

            // nobody holds a suit they've shown void in
            const voids = knownVoids(o);
            for (const s of SEATS) {
                if (s === seat) continue;
                for (const c of world.hands[s]) expect(voids[s].has(c.suit)).toBe(false);
            }
        }
    });

    it('follows the posterior when it speaks', () => {
        const g = playingState('spike-0', 0);
        const seat = g.turn!;
        const o = observe(g, seat);
        const pool = unseenCards(o);
        const target = pool[0];
        const meIdx = SEATS.indexOf(seat);
        const want = SEATS[(meIdx + 1) % 4]; // relative class 0 = next seat

        const spiked = Array.from({ length: 40 }, () => [0.25, 0.25, 0.25, 0.25]);
        spiked[cardToInt(target)] = [0.97, 0.01, 0.01, 0.01];

        const rand = seededRand(31);
        let spikeHits = 0;
        let uniformHits = 0;
        const n = 200;
        for (let k = 0; k < n; k++) {
            const w1 = sampleWorldWeighted(o, spiked, rand);
            if (w1.hands[want].some((c) => sameCard(c, target))) spikeHits++;
            const flat = Array.from({ length: 40 }, () => [0.25, 0.25, 0.25, 0.25]);
            const w2 = sampleWorldWeighted(o, flat, rand);
            if (w2.hands[want].some((c) => sameCard(c, target))) uniformHits++;
        }
        expect(spikeHits).toBeGreaterThan(uniformHits * 2);
        expect(spikeHits / n).toBeGreaterThan(0.55);
    });
});

describe('belief-guided search is blind to hidden cards', () => {
    it('scrambling unseen zones never changes the chosen card', () => {
        for (let i = 0; i < 3; i++) {
            const g = playingState(`bblind-${i}`, GEN16_SEARCH.minTrick);
            const seat = g.turn!;

            const first = chooseSearchCard(g, gen13, GEN16_SEARCH,
                seededRand(99 + i), belief);

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

            const second = chooseSearchCard(g, gen13, GEN16_SEARCH,
                seededRand(99 + i), belief);
            expect(sameCard(first.card, second.card)).toBe(true);
            expect(second.scores).toEqual(first.scores);
        }
    }, 60000);
});
