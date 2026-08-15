import { describe, expect, it } from 'vitest';
import { explainGoDown, explainLead, critiqueLead } from './explain';
import { GoDownItem, LeadItem } from './types';

// suits: 0 Red, 1 Yellow, 2 Black, 3 Green · int = suit*10 + (number-5)
const gdItem = (godown: number[], trump: number): GoDownItem => ({
    id: 1, seed: 1, hand: 0, buyer: 0,
    // Red 13,12,11 · Yellow 5,6 · Black 10 · Green 9,8,7
    dealt: [8, 7, 6, 10, 11, 25, 34, 33, 32],
    // widow: Yellow 7, Black 5, Green 6, Red 5
    widow: [12, 20, 31, 0],
    bid: 100, scores: [0, 0], dealerRel: 1, leaderRel: 2, k: 200,
    bot: { trump, godown, overrode: 0, incumbent: { godown, trump }, cands: [] },
});

describe('explainGoDown', () => {
    it('reports voids, trump kept, and buried count', () => {
        // bury all Yellow (5,6,7) + Black 5 → Yellow void, 10 pts buried
        const why = explainGoDown(gdItem([10, 11, 12, 20], 0));
        expect(why).toContain('keeps 4 Red trump');
        expect(why).toContain('empties Yellow completely');
        expect(why).toContain('banks 10 count points');
    });
    it('handles the no-void, no-count plan', () => {
        // bury Green 6,7,8 + Yellow 6 — no suit emptied, 0 count
        const why = explainGoDown(gdItem([31, 32, 33, 11], 0));
        expect(why).toContain('buries no count at all');
    });
});

const leadItem = (card: number, buyerRel: number, trump = 2): LeadItem => ({
    id: 1, seed: 1, hand: 0, seat: 0,
    // Red 8 · Yellow 5,7,8 · Black 6 · Green 6,7,12 · Red 14
    cards: [3, 10, 12, 13, 21, 31, 32, 37, 9],
    trump, bid: 95, buyerRel, declarer: 0, scores: [0, 0], k: 200,
    bot: { card, values: {} },
});

describe('explainLead', () => {
    it('low card in a long suit is a safe exit', () => {
        expect(explainLead(leadItem(31, 2))).toContain('safe exit');
    });
    it('trump into partner’s contract hands over the wheel', () => {
        expect(explainLead(leadItem(21, 2))).toContain('partner');
    });
    it('the 14 is the sure boss', () => {
        expect(explainLead(leadItem(9, 2))).toContain('sure boss');
    });
});

describe('critiqueLead', () => {
    it('flags count thrown on an uncontrolled trick', () => {
        const line = critiqueLead(leadItem(31, 2), 10);   // led Yellow 5
        expect(line).toContain('5 count points');
    });
    it('stays quiet when shapes are similar', () => {
        expect(critiqueLead(leadItem(31, 2), 32)).toBeNull();
    });
});
