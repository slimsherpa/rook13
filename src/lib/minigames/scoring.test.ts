import { describe, expect, it } from 'vitest';
import { gradeGoDown, gradeLead, levelFor, selectionPct } from './scoring';
import { GoDownItem, LeadItem } from './types';

const leadItem = (over: Partial<LeadItem['bot']> = {}): LeadItem => ({
    id: 1, seed: 1, hand: 0, seat: 0, cards: [0, 1, 2, 10, 11, 20, 21, 30, 31],
    trump: 0, bid: 100, buyerRel: 2, declarer: 1, scores: [0, 0], k: 200,
    bot: {
        card: 0,
        values: { '0': 10, '1': 9, '2': -5, '10': -20, '11': -30, '20': 2, '21': 1, '30': -8, '31': -40 },
        ...over,
    },
});

describe('gradeLead', () => {
    it('exact match is perfect and counts the selection', () => {
        const g = gradeLead(leadItem(), 0);
        expect(g.tier).toBe('perfect');
        expect(g.points).toBe(100);
        expect(g.delta).toBe(0);
        expect(g.selMatch).toBe(1);
        expect(g.selTotal).toBe(1);
    });
    it('within tau=2 is close but not a selection match', () => {
        const g = gradeLead(leadItem(), 1);   // 10 - 9 = 1 point behind
        expect(g.tier).toBe('close');
        expect(g.delta).toBe(1);
        expect(g.selMatch).toBe(0);
    });
    it('mid gap is ok with a delta', () => {
        const g = gradeLead(leadItem(), 20);  // 10 - 2 = 8 behind
        expect(g.tier).toBe('ok');
        expect(g.delta).toBe(8);
    });
    it('big gap is a miss', () => {
        const g = gradeLead(leadItem(), 31);  // 50 behind
        expect(g.tier).toBe('miss');
        expect(g.points).toBe(0);
    });
});

const gdItem = (): GoDownItem => ({
    id: 1, seed: 1, hand: 0, buyer: 0, dealt: [0, 1, 2, 3, 10, 11, 20, 30, 31],
    widow: [4, 12, 21, 32], bid: 105, scores: [0, 0], dealerRel: 1, leaderRel: 2, k: 200,
    bot: {
        trump: 0, godown: [30, 31, 32, 21], overrode: 0,
        incumbent: { godown: [30, 31, 32, 21], trump: 0 },
        cands: [
            [[30, 31, 32, 21], 0, 55.0],
            [[30, 31, 32, 20], 0, 53.5],
            [[30, 31, 20, 21], 0, 40.0],
            [[10, 11, 12, 4], 1, 12.0],
        ],
    },
});

describe('gradeGoDown', () => {
    it('same four cards and trump is perfect, 5/5 selections', () => {
        const g = gradeGoDown(gdItem(), [21, 32, 31, 30], 0);
        expect(g.tier).toBe('perfect');
        expect(g.selMatch).toBe(5);
        expect(g.selTotal).toBe(5);
    });
    it('a priced Go Down within tau=3 is close', () => {
        const g = gradeGoDown(gdItem(), [30, 31, 32, 20], 0);  // 55 - 53.5
        expect(g.tier).toBe('close');
        expect(g.delta).toBe(1.5);
        expect(g.selMatch).toBe(4);   // 3 cards + trump
    });
    it('unpriced Go Down falls back to overlap: 3/4 + trump is close', () => {
        const g = gradeGoDown(gdItem(), [30, 31, 32, 4], 0);
        expect(g.tier).toBe('close');
        expect(g.points).toBe(70);
        expect(g.headline).toContain('Go Down');
    });
    it('wrong trump is a miss with the trump callout, selections still count', () => {
        const g = gradeGoDown(gdItem(), [30, 31, 32, 21], 2);
        expect(g.tier).toBe('miss');
        expect(g.headline).toContain('different trump');
        expect(g.selMatch).toBe(4);   // 4 cards agree, trump doesn't
    });
});

describe('selectionPct and levels', () => {
    it('selection agreement counts per selection', () => {
        expect(selectionPct({ selTotal: 60, selMatch: 50 })).toBe(83);
        expect(selectionPct({ selTotal: 0, selMatch: 0 })).toBe(0);
    });
    it('levels unlock on situations played', () => {
        expect(levelFor(0)).toMatchObject({ level: 1, name: 'Rookie', next: 10 });
        expect(levelFor(10).level).toBe(2);
        expect(levelFor(24).level).toBe(2);
        expect(levelFor(25).name).toBe('Sharp');
        expect(levelFor(500)).toMatchObject({ level: 6, next: null });
    });
});
