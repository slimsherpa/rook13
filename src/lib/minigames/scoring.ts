// Beat the Bot scoring — grade a human pick against the searched answer.
//
// Framing (Riley's call): this is NOT "are you as good as the bot" — it's
// "here's what you'd do, here's what I'd do". Progress is counted in
// situations played and levels unlocked; agreement lives in a friendly
// "fun fact" percentage counted per SELECTION (each Go Down card and the
// trump call = 5 chances to agree per hand; a lead = 1).
//
// Values are family hand-points (the searchers' own currency). The
// "close" bars mirror the searchers' own indifference bars: tau=2 for a
// card play, tau=3 for a Go Down — inside that gap the bot itself would
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
    /** per-selection agreement: Go Down = 4 cards + trump, lead = 1 card */
    selTotal: number;
    selMatch: number;
}

const LEAD_CLOSE = 2;   // the play searcher's tau
const LEAD_OK = 10;
const GODOWN_CLOSE = 3; // the Go Down searcher's tau
const GODOWN_OK = 12;

export const gradeLead = (item: LeadItem, pick: number): Grade => {
    const bot = item.bot.card;
    if (pick === bot) {
        return {
            tier: 'perfect', points: 100, delta: 0, selTotal: 1, selMatch: 1,
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
    if (delta !== null && delta < 0) {
        // the human's card priced ABOVE the bot's actual pick — the
        // searcher's instinct held it back, the human went for it
        return {
            tier: 'close', points: 95, delta, selTotal: 1, selMatch: 0,
            headline: 'You may have BEATEN me on this one!',
            detail: `Your lead priced ${-delta} points ahead of my pick across these worlds — my instinct held me back.`,
        };
    }
    if (delta !== null && delta <= LEAD_CLOSE) {
        return {
            tier: 'close', points: 85, delta, selTotal: 1, selMatch: 0,
            headline: 'Basically a coin flip with my pick — nice.',
            detail: rank && rank <= 2
                ? `Your lead was my #${rank} choice, only ${delta} points behind.`
                : `Only ${delta} points behind my pick.`,
        };
    }
    if (delta !== null && delta <= LEAD_OK) {
        return {
            tier: 'ok', points: 40, delta, selTotal: 1, selMatch: 0,
            headline: 'Ooh, I found a more optimal play. What about this?',
            detail: `Your lead gives up about ${delta} points${rank ? ` (my #${rank} choice)` : ''}.`,
        };
    }
    return {
        tier: 'miss', points: 0, delta, selTotal: 1, selMatch: 0,
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
    const overlap = godown.filter((c) => bot.godown.includes(c)).length;
    const trumpMatch = trump === bot.trump;
    const selMatch = overlap + (trumpMatch ? 1 : 0);
    const sel = { selTotal: 5, selMatch };

    if (trumpMatch && overlap === 4) {
        return {
            tier: 'perfect', points: 100, delta: 0, ...sel,
            headline: 'Good job! That’s exactly what I would have picked.',
        };
    }
    // was the human's exact (Go Down, trump) in the searched shortlist?
    const mine = bot.cands.find(([gd, t]) => t === trump && sameSet(gd, godown));
    const best = bot.cands.find(([gd, t]) => t === bot.trump && sameSet(gd, bot.godown));
    const delta = mine && best
        ? Math.round((best[2] - mine[2]) * 10) / 10 : null;

    if (delta !== null && delta < 0) {
        return {
            tier: 'close', points: 95, delta, ...sel,
            headline: 'You may have BEATEN me on this one!',
            detail: `I priced your exact Go Down — it came out ${-delta} points ahead of mine in these worlds.`,
        };
    }
    if (delta !== null && delta <= GODOWN_CLOSE) {
        return {
            tier: 'close', points: 85, delta, ...sel,
            headline: 'I priced that exact Go Down — it’s a coin flip with mine.',
            detail: `Within ${Math.max(delta, 0.1)} points of what I put down.`,
        };
    }
    if (trumpMatch && overlap >= 3) {
        return {
            tier: 'close', points: 70, delta, ...sel,
            headline: 'So close — we agree on trump and most of the Go Down.',
            detail: `You matched ${overlap} of the 4 cards I put down.`,
        };
    }
    if (trumpMatch && overlap >= 2) {
        return {
            tier: 'ok', points: 40, delta, ...sel,
            headline: 'I found a better Go Down. What about this?',
            detail: `Same trump, but we agree on only ${overlap} of the 4 cards.`,
        };
    }
    return {
        tier: 'miss', points: trumpMatch ? 20 : 0, delta, ...sel,
        headline: trumpMatch
            ? 'I found a better Go Down. What about this?'
            : 'I’d even call a different trump here. Take a look.',
        detail: delta !== null ? `About ${delta} points apart.` : undefined,
    };
};

/** "Fun fact! You and the bot agree on X% of selections." */
export const selectionPct = (p: { selTotal: number; selMatch: number }) =>
    p.selTotal > 0 ? Math.round((p.selMatch / p.selTotal) * 100) : 0;

/** Levels unlock on situations played (both drills combined or per
 *  drill — the caller sums what it wants). */
const LEVELS: Array<[number, string]> = [
    [0, 'Rookie'], [10, 'Regular'], [25, 'Sharp'], [50, 'Veteran'],
    [100, 'Master'], [200, 'Legend'],
];

export interface LevelInfo {
    level: number;          // 1-based
    name: string;
    /** situations needed for the next level, or null at the top */
    next: number | null;
}

export const levelFor = (attempts: number): LevelInfo => {
    let i = 0;
    while (i + 1 < LEVELS.length && attempts >= LEVELS[i + 1][0]) i++;
    return {
        level: i + 1,
        name: LEVELS[i][1],
        next: i + 1 < LEVELS.length ? LEVELS[i + 1][0] : null,
    };
};
