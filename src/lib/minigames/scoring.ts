// Beat the Bot scoring — grade a human pick against the searched answer.
//
// Values are family hand-points (the searchers' own currency). The
// "close" bars mirror the searchers' own indifference bars: tau=2 for a
// card play, tau=3 for a burial — inside that gap the bot itself would
// call it a coin flip.

import { GoDownItem, LeadItem } from './types';

export type Tier = 'perfect' | 'close' | 'ok' | 'miss';

export interface Grade {
    tier: Tier;
    points: number;        // 0-100 toward the running score
    /** value gap to the bot's pick, when the pick is priced; null when
     *  the human combo wasn't in the searched shortlist */
    delta: number | null;
    headline: string;
    detail?: string;
}

const LEAD_CLOSE = 2;   // the play searcher's tau
const LEAD_OK = 10;
const GODOWN_CLOSE = 3; // the widow searcher's tau
const GODOWN_OK = 12;

export const gradeLead = (item: LeadItem, pick: number): Grade => {
    const bot = item.bot.card;
    if (pick === bot) {
        return {
            tier: 'perfect', points: 100, delta: 0,
            headline: 'Good job! That’s exactly what I would have picked.',
        };
    }
    const v = item.bot.values;
    const vBot = v[String(bot)];
    const vPick = v[String(pick)];
    const delta = vBot !== undefined && vPick !== undefined
        ? Math.round((vBot - vPick) * 10) / 10 : null;
    // rank of the human pick among all priced leads (1 = best)
    const rank = vPick === undefined ? null
        : Object.values(v).filter((x) => x > vPick).length + 1;
    if (delta !== null && delta <= LEAD_CLOSE) {
        return {
            tier: 'close', points: 85, delta,
            headline: 'Basically a coin flip with my pick — nice.',
            detail: rank && rank <= 2
                ? `Your lead was my #${rank} choice, only ${delta} points behind.`
                : `Only ${delta} points behind my pick.`,
        };
    }
    if (delta !== null && delta <= LEAD_OK) {
        return {
            tier: 'ok', points: 40, delta,
            headline: 'Ooh, I found a more optimal play. What about this?',
            detail: `Your lead gives up about ${delta} points${rank ? ` (my #${rank} choice)` : ''}.`,
        };
    }
    return {
        tier: 'miss', points: 0, delta,
        headline: 'Ooh, I found a more optimal play. What about this?',
        detail: delta !== null
            ? `Your lead gives up about ${delta} points.`
            : undefined,
    };
};

const sameSet = (a: number[], b: number[]) => {
    if (a.length !== b.length) return false;
    const s = new Set(a);
    return b.every((x) => s.has(x));
};

export const gradeGoDown = (
    item: GoDownItem, godown: number[], trump: number,
): Grade => {
    const bot = item.bot;
    if (trump === bot.trump && sameSet(godown, bot.godown)) {
        return {
            tier: 'perfect', points: 100, delta: 0,
            headline: 'Good job! That’s exactly what I would have picked.',
        };
    }
    // was the human's exact (burial, trump) in the searched shortlist?
    const mine = bot.cands.find(([gd, t]) => t === trump && sameSet(gd, godown));
    const best = bot.cands.find(([gd, t]) => t === bot.trump && sameSet(gd, bot.godown));
    const delta = mine && best
        ? Math.round((best[2] - mine[2]) * 10) / 10 : null;
    const overlap = godown.filter((c) => bot.godown.includes(c)).length;
    const trumpMatch = trump === bot.trump;

    if (delta !== null && delta <= GODOWN_CLOSE) {
        return {
            tier: 'close', points: 85, delta,
            headline: 'I priced that exact burial — it’s a coin flip with mine.',
            detail: `Within ${Math.max(delta, 0.1)} points of my pick.`,
        };
    }
    if (trumpMatch && overlap >= 3) {
        return {
            tier: 'close', points: 70, delta,
            headline: 'So close — we agree on trump and most of the burial.',
            detail: `You matched ${overlap} of my 4 cards.`,
        };
    }
    if (trumpMatch && overlap >= 2) {
        return {
            tier: 'ok', points: 40, delta,
            headline: 'Ooh, I found a more optimal burial. What about this?',
            detail: `Same trump, but only ${overlap} of my 4 cards.`,
        };
    }
    return {
        tier: 'miss', points: trumpMatch ? 20 : 0, delta,
        headline: trumpMatch
            ? 'Ooh, I found a more optimal burial. What about this?'
            : 'I’d even call a different trump here. Take a look.',
        detail: delta !== null ? `About ${delta} points apart.` : undefined,
    };
};

/** Agreement rate for the headline stat: perfect + close count as
 *  "picked with the bot". */
export const agreementPct = (p: { attempts: number; perfect: number; close: number }) =>
    p.attempts > 0 ? Math.round(((p.perfect + p.close) / p.attempts) * 100) : 0;
