// Beat the Bot mini-games — situation banks and progress shapes.
//
// Banks are milled offline on Riley's MBP by ml/alpharook/minigame_mill.py
// (Gen26 reflex self-play; MortalWidow / anytime searchers answer at a
// pinned K) and ship as static JSON under public/minigames/. Item id ==
// mill seed, so banks grow by appending without invalidating progress.

import { Card, SUITS } from '../game/types';

/** Card int encoding shared with the ML side: suitIdx*10 + (number-5). */
export const toCard = (c: number): Card => ({
    suit: SUITS[Math.floor(c / 10)],
    number: (c % 10) + 5,
});
export const toInt = (c: Card): number =>
    SUITS.indexOf(c.suit) * 10 + (c.number - 5);

export interface BankMeta {
    gen: string;      // "gen26-daydream"
    k: number;        // belief worlds per decision
    updated: string;
    count: number;
}

/** One go-down situation: you bought it, pick trump and bury four. */
export interface GoDownItem {
    id: number;
    seed: number;
    hand: number;
    buyer: number;
    dealt: number[];      // the 9 dealt cards
    widow: number[];      // the 4 widow cards
    bid: number;
    scores: [number, number];   // [my team, theirs]
    dealerRel: number;
    leaderRel: number;
    k: number;
    bot: {
        trump: number;
        godown: number[];
        overrode: number;
        incumbent: { godown: number[]; trump: number };
        /** shortlisted burials, best first: [godown, trump, meanValue] */
        cands: Array<[number[], number, number]>;
    };
}

/** One opening-lead situation: trump is called, you lead trick 1. */
export interface LeadItem {
    id: number;
    seed: number;
    hand: number;
    seat: number;
    cards: number[];      // the leader's 9
    trump: number;
    bid: number;
    buyerRel: number;     // 0 me · 1 left · 2 partner · 3 right
    declarer: number;     // 1 if the leader's team bought it
    scores: [number, number];
    k: number;
    bot: {
        card: number;
        /** every legal lead priced: cardInt -> mean family value */
        values: Record<string, number>;
    };
}

export interface Bank<T> {
    meta: BankMeta;
    items: T[];
}

export type MiniGameKey = 'godown' | 'lead';

/** Per-player progress, one doc per game at users/{uid}/minigames/{game}. */
export interface MiniGameProgress {
    game: MiniGameKey;
    attempts: number;
    perfect: number;      // exactly the bot's pick
    close: number;        // near-optimal (see scoring.ts)
    points: number;       // cumulative 0-100 per attempt
    streak: number;       // current perfect-or-close run
    bestStreak: number;
    done: number[];       // completed item ids
    updatedAt: number;
}

export const emptyProgress = (game: MiniGameKey): MiniGameProgress => ({
    game, attempts: 0, perfect: 0, close: 0, points: 0,
    streak: 0, bestStreak: 0, done: [], updatedAt: 0,
});

export const loadBank = async <T>(game: MiniGameKey): Promise<Bank<T>> => {
    const res = await fetch(`/minigames/${game === 'godown' ? 'godown' : 'lead'}_items.json`);
    if (!res.ok) throw new Error(`bank ${game}: ${res.status}`);
    const raw = await res.json();
    // tolerate a bare array (early banks had no meta wrapper)
    return Array.isArray(raw)
        ? { meta: { gen: '?', k: 0, updated: '', count: raw.length }, items: raw }
        : raw;
};
