// AI-assistant advice: turn the champion's Q values for the decision facing
// a seat into a "how likely would the model pick this" number per option, for
// the on-table coaching dials. The net is deterministic (it plays the argmax),
// so "likelihood" is a softened reading of its preferences — softmax at a
// temperature tuned so the spread is legible rather than a near-tie. Always
// runs on the latest shipped brain (gen13 weights = the gen16 reflex).

import { GameDoc, Seat, SUITS, cardKey } from '@/lib/game/types';
import { QNetWeights } from './qnet';
import { neuralChoice, neuralTrumpIntent, neuralGoDownAdvice } from './agent';
import { intToCard, PASS } from './encoder';

// spread control: Q lives in ~[-1, 1] with meaningful gaps of ~0.05–0.2, so a
// small temperature turns those gaps into a readable dial (a 0.1 Q edge ≈ 2.7×
// the odds). Purely presentational — it never changes what any bot plays.
const TEMP = 0.1;

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
        const advice = neuralGoDownAdvice(g, seat, net);
        const p = softmax(advice.map((a) => a.q));
        advice.forEach((a, i) => out.set(optionKey.card(cardKey(intToCard(a.cand))), p[i]));
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
