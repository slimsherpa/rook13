// The ranked ladder engine — a margin-aware Elo, StarCraft-style, replayed
// from a player's game history. Pure math, no Firebase (the fetch + cache
// layer lives in lib/firebase/skillService.ts).
//
// Why replay instead of storing a number: every finished game already lives
// at users/{uid}/history/{gameId} with the final scores and the full seat
// snapshot (which bots, what styles), so the rating is always recomputable
// from first principles — no migration, no drift, and past games count the
// moment this ships. Nobody has to replay anything.
//
// The three laws of the ladder (Riley's spec, 2026-08-17):
//   1. Opponent strength matters. Every bot brain has an anchor rating;
//      beating a table of Stompers when you're Gold pays almost nothing,
//      beating Cosmo pays real points, and LOSING to Cosmo costs almost
//      nothing. On top of Elo's own expectation curve, rating GAINS fade
//      to zero once you outrank a table by OUTRANK_SPAN — so farming easy
//      bots hard-stops around Gold/low-Platinum no matter the grind.
//   2. Margin matters more than the W. The game score is blended into the
//      Elo result: a 48% win rate with close losses and big wins climbs
//      (that's Nate), while coin-flip blowout trades tread water.
//   3. Help costs climb. Games where the AI Trainer or Card Counter was on
//      still count, but rating GAINS are taxed (losses count in full — the
//      trainer can't shield you on the way down).
//
// Tourney seeding (future JAY CUP mini-championship): seed from `rating`
// here, break ties with the mini-game layer (lib/minigames/difficulty.ts).
// Both are deterministic replays, so a seeding run needs no new state.

import { BotStyle, Seat, SeatInfo, SEATS, Team, partnerOf, teamOf } from './types';

/** Bump when the formula changes — invalidates the localStorage cache. */
export const SKILL_VERSION = 1;

export const START_SKILL = 1000;
/** Ranked games needed to leave the Rookie/placement pool. */
export const PLACEMENT_GAMES = 3;

// Graduated K, StarCraft-style: big placement swings, a fast mid-climb
// (the whole family starts a fresh ladder at 1000 — convergence matters),
// then a settled cadence.
const K_BY_GAMES: Array<[number, number]> = [[8, 64], [20, 48], [Infinity, 32]];
const RATING_FLOOR = 600;

/** Rating gains fade linearly to zero as you outrank the opposing table,
 *  hitting zero at this many points above it. This is the anti-farm law:
 *  Elo alone would let 500 blowouts of Stomper creep to GrandMaster. */
const OUTRANK_SPAN = 150;

/** Full credit for margin at ±350 game points (a comfortable blowout). */
const MARGIN_FULL = 350;
/** Blend: how much the W is worth vs the score margin. */
const WIN_WEIGHT = 0.55;

/** Rating gains keep this fraction when the AI Trainer was on… */
const ASSIST_GAIN = 0.5;
/** …and this fraction when only the Card Counter was up (lighter aid). */
const COUNTER_GAIN = 0.7;

/**
 * Anchor ratings for the bot brains, calibrated to the tier floors in
 * rank.ts: a player who trades even with a brain settles near its anchor.
 * The camp ladder (Stomper → Cosmo) spans Silver up to GrandMaster's door.
 */
export const BOT_ANCHORS: Record<BotStyle, number> = {
    random: 850,
    basic: 1000,
    aggressive: 1050,
    cautious: 1050,
    gen7: 1080,
    gen8: 1120,
    alpharook: 1250,
    gen9: 1150,      // Stomper, the rookie
    gen10: 1220,     // Kitten
    gen11: 1290,     // Bobcat
    gen13: 1370,     // Cub
    gen16: 1460,     // Puma
    gen19: 1560,     // Cougar
    gen21: 1600,
    gen23: 1650,
    gen26: 1700,     // Cosmo, the grandmaster
    teacher: 1750,
    gardner: 1700,
    godrook: 1950,   // sees every card
};
/** A gen26 seat while the table's DayDream toggle is on. */
export const DAYDREAM_ANCHOR = 1800;
/** Legacy docs with an unreadable seat snapshot land mid-ladder. */
const UNKNOWN_ANCHOR = 1300;

/** One finished game, as replayed — mapped from a GameHistoryEntry. */
export interface SkillGame {
    seat: Seat;
    seats?: Record<Seat, SeatInfo>;
    scores?: Record<Team, number>;
    won: boolean;
    finishedAt: number;
    /** the table's DayDream toggle (recorded from 2026-08 on) */
    botThink?: boolean;
    /** AI Trainer on at any recorded point of the game */
    assistUsed?: boolean;
    /** Card Counter up at any recorded point of the game */
    counterUsed?: boolean;
}

export interface SkillResult {
    /** the ladder rating, rounded */
    rating: number;
    /** finished games replayed into it */
    ranked: number;
    /** still in placements (ranked < PLACEMENT_GAMES) */
    provisional: boolean;
}

const expectedScore = (mine: number, theirs: number): number =>
    1 / (1 + Math.pow(10, (theirs - mine) / 400));

/** A seat's strength: bots by anchor, humans/open assumed to be my peer. */
const strengthOf = (
    info: SeatInfo | undefined, peer: number, botThink: boolean,
): number => {
    if (!info || info.kind !== 'bot') return peer;
    const style = info.botStyle;
    if (!style) return UNKNOWN_ANCHOR;
    if (style === 'gen26' && botThink) return DAYDREAM_ANCHOR;
    return BOT_ANCHORS[style] ?? UNKNOWN_ANCHOR;
};

/** The rating delta for one game at a given current rating. Exported so
 *  tests and the (future) post-game "+12 SR" toast share the exact math. */
export const gameDelta = (rating: number, g: SkillGame, ranked: number): number => {
    const myTeam = teamOf(g.seat);
    const otherTeam: Team = myTeam === 'A' ? 'B' : 'A';
    const botThink = !!g.botThink;

    const partner = strengthOf(g.seats?.[partnerOf(g.seat)], rating, botThink);
    const opps = SEATS.filter((s) => teamOf(s) !== myTeam)
        .map((s) => strengthOf(g.seats?.[s], rating, botThink));

    const teamRating = (rating + partner) / 2;
    const oppRating = (opps[0] + opps[1]) / 2;
    const expected = expectedScore(teamRating, oppRating);

    const margin = g.scores
        ? (g.scores[myTeam] ?? 0) - (g.scores[otherTeam] ?? 0)
        : 0;
    const marginFrac = Math.max(-1, Math.min(1, margin / MARGIN_FULL));
    const actual = WIN_WEIGHT * (g.won ? 1 : 0)
        + (1 - WIN_WEIGHT) * (0.5 + 0.5 * marginFrac);

    const k = K_BY_GAMES.find(([until]) => ranked < until)![1];
    let delta = k * (actual - expected);
    if (delta > 0) {
        // outranking the table: wins over bots far beneath you stop paying
        const outrank = rating - oppRating;
        if (outrank > 0) delta *= Math.max(0, 1 - outrank / OUTRANK_SPAN);
        if (g.assistUsed) delta *= ASSIST_GAIN;
        else if (g.counterUsed) delta *= COUNTER_GAIN;
    }
    return delta;
};

/** Replay a player's finished games, oldest first, into a ladder rating. */
export const replaySkill = (games: SkillGame[]): SkillResult => {
    const ordered = [...games].sort((a, b) => a.finishedAt - b.finishedAt);
    let rating = START_SKILL;
    let ranked = 0;
    for (const g of ordered) {
        rating = Math.max(RATING_FLOOR, rating + gameDelta(rating, g, ranked));
        ranked++;
    }
    return {
        rating: Math.round(rating),
        ranked,
        provisional: ranked < PLACEMENT_GAMES,
    };
};
