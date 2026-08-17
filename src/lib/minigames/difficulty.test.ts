import { describe, expect, it } from 'vitest';
import {
    LAYER_NEED, LAYER_TIERS, LAYER_WINDOW, TOP_LAYER,
    advanceLayer, godownGap, layersFor, leadGap, pickNext,
} from './difficulty';
import { GoDownItem, LeadItem } from './types';

const lead = (id: number, values: Record<string, number>, cards?: number[]): LeadItem => ({
    id, seed: id, hand: 1, seat: 0,
    cards: cards ?? Object.keys(values).map(Number),
    trump: 0, bid: 100, buyerRel: 0, declarer: 1, scores: [0, 0], k: 200,
    bot: { card: Number(Object.keys(values)[0]), values },
});

describe('difficulty gaps', () => {
    it('leadGap = best minus second-best distinct lead', () => {
        expect(leadGap(lead(1, { '3': 20, '15': 10, '27': -5 }))).toBe(10);
    });

    it('leadGap collapses touching twins into one class', () => {
        // 3 and 4 touch (both held) — same card in play, so the real
        // decision gap is 20 - 5, not 20 - 19
        expect(leadGap(lead(1, { '3': 20, '4': 19, '15': 5 }))).toBe(15);
    });

    it('single-class hands are trivially easy (Infinity)', () => {
        expect(leadGap(lead(1, { '3': 20, '4': 19 }))).toBe(Infinity);
    });

    it('godownGap = best minus second-best distinct burial', () => {
        const item: GoDownItem = {
            id: 1, seed: 1, hand: 1, buyer: 0,
            dealt: [1, 2, 3, 11, 12, 13, 21, 22, 23], widow: [31, 32, 33, 4],
            bid: 100, scores: [0, 0], dealerRel: 0, leaderRel: 0, k: 200,
            bot: {
                trump: 0, godown: [31, 32, 33, 4], overrode: 0,
                incumbent: { godown: [31, 32, 33, 4], trump: 0 },
                cands: [
                    [[31, 32, 33, 4], 0, 25],
                    [[31, 32, 33, 3], 0, 24.5],   // 3 & 4 touch → same class? (3,4 both held)
                    [[21, 22, 23, 4], 1, 12],
                ],
            },
        };
        // first two cands collapse only if their run classes match; 31,32,33
        // touch each other and 3,4 touch — both burials share the class set,
        // so the real gap is vs the trump-1 candidate: 25 - 12
        expect(godownGap(item)).toBe(13);
    });
});

describe('layersFor', () => {
    it('buckets a bank easiest-first into all layers', () => {
        const items = Array.from({ length: 100 }, (_, i) =>
            lead(i, { '3': 100 - i, '15': 0 }));   // gap shrinks with id
        const layers = layersFor(items, leadGap);
        expect(layers.get(0)).toBe(0);              // biggest gap → Bronze
        expect(layers.get(99)).toBe(TOP_LAYER);     // hairline call → GM
        // every layer is populated and monotone with difficulty
        const seen = new Set(layers.values());
        expect(seen.size).toBe(LAYER_TIERS.length);
        for (let i = 1; i < 100; i++) {
            expect(layers.get(i)!).toBeGreaterThanOrEqual(layers.get(i - 1)!);
        }
    });
});

describe('pickNext', () => {
    const items = Array.from({ length: 70 }, (_, i) => lead(i, { '3': 100 - i, '15': 0 }));
    const layers = layersFor(items, leadGap);

    it('serves the current layer first', () => {
        const it = pickNext(items, layers, 0, new Set());
        expect(layers.get(it!.id)).toBe(0);
    });

    it('spills up when the current layer is exhausted', () => {
        const bronzeDone = new Set(items.filter((i) => layers.get(i.id) === 0).map((i) => i.id));
        const it = pickNext(items, layers, 0, bronzeDone);
        expect(layers.get(it!.id)).toBe(1);
    });

    it('returns null only when everything is done', () => {
        expect(pickNext(items, layers, 3, new Set(items.map((i) => i.id)))).toBeNull();
    });
});

describe('advanceLayer', () => {
    it(`promotes at ${LAYER_NEED} hits and clears the window`, () => {
        let state: ReturnType<typeof advanceLayer> = { layer: 0, recent: [], promoted: false };
        for (let i = 0; i < LAYER_NEED - 1; i++) {
            state = advanceLayer(state, true);
            expect(state.promoted).toBe(false);
        }
        state = advanceLayer(state, true);
        expect(state).toEqual({ layer: 1, recent: [], promoted: true });
    });

    it('misses age out of the rolling window', () => {
        let state = { layer: 0, recent: [] as number[] };
        for (let i = 0; i < LAYER_WINDOW; i++) state = advanceLayer(state, false);
        // window is full of misses; LAYER_NEED straight hits still can't
        // promote until enough misses age out… but hits also push misses
        // out, so exactly LAYER_NEED hits after (WINDOW - NEED) more slide
        for (let i = 0; i < LAYER_NEED - 1; i++) state = advanceLayer(state, true);
        expect(state.layer).toBe(0);
        state = advanceLayer(state, true);
        // last 14: 4 misses + 10 hits → promoted
        expect(state.layer).toBe(1);
    });

    it('never promotes past the top layer', () => {
        let state: ReturnType<typeof advanceLayer> = { layer: TOP_LAYER, recent: [], promoted: false };
        for (let i = 0; i < LAYER_WINDOW * 2; i++) state = advanceLayer(state, true);
        expect(state.layer).toBe(TOP_LAYER);
        expect(state.promoted).toBe(false);
    });

    it('treats pre-layer docs as Bronze with an empty window', () => {
        expect(advanceLayer({}, true)).toEqual({ layer: 0, recent: [1], promoted: false });
    });
});
