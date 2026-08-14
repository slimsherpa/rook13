// AI-assistant advice: turn the champion's Q values for the decision facing
// a seat into a "how likely would the model pick this" number per option, for
// the on-table coaching dials. The net is deterministic (it plays the argmax),
// so "likelihood" is a softened reading of its preferences — softmax at a
// temperature tuned so the spread is legible rather than a near-tie. Always
// runs on the latest shipped brain (gen26 — the Gardner-style reflex).

import { GameDoc, Seat, SUITS, cardKey } from '@/lib/game/types';
import { QNetWeights } from './qnet';
import { neuralChoice, neuralTrumpIntent, neuralWidow } from './agent';
import { intToCard, PASS } from './encoder';

// spread control: TEMP = gen26's median top-2 Q gap (QCAL fleet fit,
// 2026-08-13, 48k decisions), so the MEDIAN decision reads as ~2.7× the
// odds — the same dial feel the gen13-era TEMP=0.1 was tuned for, carried
// across the Q-scale change. Purely presentational — it never changes
// what any bot plays.
const TEMP = 1.474;

const softmax = (qs: number[], temp = TEMP): number[] => {
    const m = Math.max(...qs);
    const ex = qs.map((q) => Math.exp((q - m) / temp));
    const z = ex.reduce((a, b) => a + b, 0);
    return ex.map((e) => e / z);
};

export type AdviceMap = Map<string, number>;

// keys the dials look up:
//   bid:    'pass' | '65'..'120'
//   trump:  'Red' | 'Yellow' | 'Black' | 'Green'
//   card:   `${suit}-${number}` (cardKey) — used for both go-down and play
export const optionKey = {
    bid: (bid: number | 'pass') => `bid:${bid}`,
    trump: (suit: string) => `trump:${suit}`,
    card: (key: string) => `card:${key}`,
};

/**
 * The model's pick-likelihood over the options this seat is choosing among
 * right now, keyed for the dial components. Empty when it isn't this seat's
 * decision (or the phase has no modelled choice).
 */
export const modelAdvice = (g: GameDoc, seat: Seat, net: QNetWeights): AdviceMap => {
    const out: AdviceMap = new Map();

    if (g.phase === 'bidding' && g.turn === seat) {
        const c = neuralChoice(g, seat, net);
        if (c) {
            const p = softmax(c.q);
            c.cands.forEach((cand, i) => {
                const label = cand === PASS ? 'pass' : cand;
                out.set(optionKey.bid(label), p[i]);
            });
        }
        return out;
    }

    if (g.phase === 'trump' && g.bidWinner === seat) {
        const c = neuralTrumpIntent(g, seat, net);
        const p = softmax(c.q);
        c.cands.forEach((suitIdx, i) => out.set(optionKey.trump(SUITS[suitIdx]), p[i]));
        return out;
    }

    if (g.phase === 'widow' && g.bidWinner === seat) {
        // Which FOUR the bot would bury: replay its full sequential widow
        // process (trump intent, then 4 discards each conditioned on the
        // picks so far) and light those cards full-dial. The first-pick
        // softmax alone lit only one card and hid the other three of the
        // go-down (Riley, 2026-08-13); it survives as a faint glow on the
        // near-miss alternatives.
        const w = neuralWidow(g, seat, net);
        const first = w.picks[0];
        const p = softmax(first.q);
        first.cands.forEach((cand, i) =>
            out.set(optionKey.card(cardKey(intToCard(cand))), 0.25 * p[i]));
        for (const c of w.goDown) out.set(optionKey.card(cardKey(intToCard(c))), 1.0);
        return out;
    }

    if (g.phase === 'playing' && g.turn === seat) {
        const c = neuralChoice(g, seat, net);
        if (c) {
            const p = softmax(c.q);
            c.cands.forEach((cand, i) => out.set(optionKey.card(cardKey(intToCard(cand))), p[i]));
        }
        return out;
    }

    return out;
};

// The super-trainer's sharpened dials: searched values arrive in FAMILY
// POINTS (belief-world means from the cloud DayDream), so the temperature
// is a points-temperature. τ = 2 pts is the searcher's own override bar —
// a 2-point gap is exactly what it treats as decisive, so the dial shows
// "decisive" the same way the bot feels it.
const DEEP_TEMP = 2.0;

/** AdviceMap from the cloud /advise response: the searched shortlist gets
 *  softmaxed values; every other legal card reads 0 (it fell below the
 *  reflex's top-6 and was never priced). */
export const deepAdvice = (
    legalCands: number[], cands: number[], values: number[],
): AdviceMap => {
    const out: AdviceMap = new Map();
    const p = softmax(values, DEEP_TEMP);
    for (const c of legalCands) out.set(optionKey.card(cardKey(intToCard(c))), 0);
    cands.forEach((c, i) => out.set(optionKey.card(cardKey(intToCard(c))), p[i]));
    return out;
};
