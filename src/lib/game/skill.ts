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
// The four laws of the ladder (Riley's spec 2026-08-17, retuned against
// the real family data the same day):
//   1. Opponent strength matters. Every bot brain has an anchor rating,
//      and HUMAN seats count at that human's actual ladder skill (the
//      board iterates to a fixed point — see boardSkills). Beating Cosmo
//      pays; losing to Cosmo barely stings. Rating gains fade to zero
//      once you outrank a table by OUTRANK_SPAN, so farming easy bots
//      hard-stops well short of the top tiers.
//   2. Margin matters, gently. Real Rook games to 500 end ±350 on
//      average, so the margin scale is wide (MARGIN_FULL) — the blend
//      separates nail-biters from blowouts without drowning the W.
//   3. Help costs a little. Trainer/counter games keep 75%/85% of gains
//      (losses in full). Tuned down from 50% after the real data showed
//      the tax burying LEARNING players (Nathan's 55 games vs the
//      hardest bots net out above expectation — the old tax erased it).
//   4. The grind is real credit. The shown ladder rating is
//      skill + grindOf(games): +1.5 SR per finished game, capped at 200
//      games. 219 games of showing up is worth ~2 tiers of shown rating
//      (that's Tyler), but grind alone can never mint a GrandMaster —
//      GM demands GM_SKILL_FLOOR of pure skill plus a games gate.
//
// Tier gates (TIER_GATES): Diamond 40+, Master 75+, GM 100+ finished
// games — a hot 29-game run (Sydney) waits at Platinum until the sample
// proves out, StarCraft-style.
//
// Tourney seeding (future JAY CUP mini-championship): seed from shown
// rating, break ties with the mini-game layer (lib/minigames/difficulty.ts).
// Both are deterministic replays, so a seeding run needs no new state.

import { BotStyle, Seat, SeatInfo, SEATS, Team, partnerOf, teamOf } from './types';

/** Bump when the formula changes — invalidates the localStorage cache. */
export const SKILL_VERSION = 2;

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
const OUTRANK_SPAN = 250;

/** Full credit for margin at ±600 game points. Real family games to 500
 *  average ±350 — a 350 scale saturated on almost every game and reduced
 *  the blend to pure W/L. */
const MARGIN_FULL = 600;
/** Blend: how much the W is worth vs the score margin. */
const WIN_WEIGHT = 0.55;

/** Rating gains keep this fraction when the AI Trainer was on… */
const ASSIST_GAIN = 0.75;
/** …and this fraction when only the Card Counter was up (lighter aid). */
const COUNTER_GAIN = 0.85;

/** Law 4 — the grind: shown rating credit per finished game, capped. */
const GRIND_PER_GAME = 1.5;
const GRIND_CAP_GAMES = 200;
export const grindOf = (ranked: number): number =>
    Math.round(GRIND_PER_GAME * Math.min(ranked, GRIND_CAP_GAMES));

/** GM demands this much PURE skill — grind can carry a shown rating past
 *  the GM floor, but never mint the lightning bolt by itself. */
export const GM_SKILL_FLOOR = 1650;

/** Finished games required to WEAR the top tier badges (shown rating can
 *  run ahead; the badge waits for the sample). Keys match RANK_TIERS. */
export const TIER_GATES: Record<string, number> = {
    diamond: 40,
    master: 75,
    grandmaster: 100,
};

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
    /** the SHOWN ladder rating: skill + grindOf(ranked), rounded */
    rating: number;
    /** pure skill (no grind) — gates GM, feeds other players' replays */
    skill: number;
    /** finished games replayed into it */
    ranked: number;
    /** still in placements (ranked < PLACEMENT_GAMES) */
    provisional: boolean;
}

const expectedScore = (mine: number, theirs: number): number =>
    1 / (1 + Math.pow(10, (theirs - mine) / 400));

/** A seat's strength: bots by anchor; humans by their actual ladder skill
 *  when the board map knows them, my peer otherwise. */
const strengthOf = (
    info: SeatInfo | undefined, peer: number, botThink: boolean,
    board: Record<string, number>,
): number => {
    if (!info || info.kind !== 'bot') {
        const uid = info?.uid;
        if (uid && board[uid] !== undefined) return board[uid];
        return peer;
    }
    const style = info.botStyle;
    if (!style) return UNKNOWN_ANCHOR;
    if (style === 'gen26' && botThink) return DAYDREAM_ANCHOR;
    return BOT_ANCHORS[style] ?? UNKNOWN_ANCHOR;
};

/** The rating delta for one game at a given current rating. Exported so
 *  tests and the (future) post-game "+12 SR" toast share the exact math.
 *  `board` maps human uids to their current skill (see boardSkills). */
export const gameDelta = (
    rating: number, g: SkillGame, ranked: number,
    board: Record<string, number> = {},
): number => {
    const myTeam = teamOf(g.seat);
    const otherTeam: Team = myTeam === 'A' ? 'B' : 'A';
    const botThink = !!g.botThink;

    const partner = strengthOf(g.seats?.[partnerOf(g.seat)], rating, botThink, board);
    const opps = SEATS.filter((s) => teamOf(s) !== myTeam)
        .map((s) => strengthOf(g.seats?.[s], rating, botThink, board));

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

/** Replay a player's finished games, oldest first, into a ladder rating.
 *  `board` supplies other humans' skills; `selfUid` keeps a player's own
 *  seat from resolving through the map mid-replay. */
export const replaySkill = (
    games: SkillGame[],
    board: Record<string, number> = {},
    selfUid?: string,
): SkillResult => {
    const scoped = selfUid !== undefined && board[selfUid] !== undefined
        ? Object.fromEntries(Object.entries(board).filter(([k]) => k !== selfUid))
        : board;
    const ordered = [...games].sort((a, b) => a.finishedAt - b.finishedAt);
    let rating = START_SKILL;
    let ranked = 0;
    for (const g of ordered) {
        rating = Math.max(RATING_FLOOR, rating + gameDelta(rating, g, ranked, scoped));
        ranked++;
    }
    const skill = Math.round(rating);
    return {
        rating: skill + grindOf(ranked),
        skill,
        ranked,
        provisional: ranked < PLACEMENT_GAMES,
    };
};

/**
 * The Climb — the five bars a profile shows instead of numbers (Riley's
 * call: no scores, just bars). Each is 0..1 and maps to a real input of
 * the ladder engine, so the bars ARE the honest answer to "how do I
 * rank up": play more, win bigger, sit with stronger tables, skip the
 * assists, master the drills (that last one comes from minigames
 * progress, not from here).
 */
export interface ClimbStats {
    ranked: number;
    /** games toward the grind cap */
    grind: number;
    /** average game result (the engine's own W+margin blend), stretched
     *  for display so the family's range reads on a bar */
    winning: number;
    /** average table strength faced */
    opposition: number;
    /** share of games played without trainer or counter */
    clean: number;
}

const HUMAN_CLIMB_STRENGTH = 1500;   // family seats, flat, for the bar only

export const climbOf = (games: SkillGame[]): ClimbStats => {
    const done = games.filter((g) => g.finishedAt !== undefined);
    const n = done.length;
    if (n === 0) return { ranked: 0, grind: 0, winning: 0, opposition: 0, clean: 0 };
    let sSum = 0;
    let oppSum = 0;
    let clean = 0;
    for (const g of done) {
        const myTeam = teamOf(g.seat);
        const otherTeam: Team = myTeam === 'A' ? 'B' : 'A';
        const margin = g.scores
            ? (g.scores[myTeam] ?? 0) - (g.scores[otherTeam] ?? 0)
            : 0;
        const marginFrac = Math.max(-1, Math.min(1, margin / MARGIN_FULL));
        sSum += WIN_WEIGHT * (g.won ? 1 : 0)
            + (1 - WIN_WEIGHT) * (0.5 + 0.5 * marginFrac);
        const opps = SEATS.filter((s) => teamOf(s) !== myTeam).map((s) => {
            const info = g.seats?.[s];
            if (!info || info.kind !== 'bot') return HUMAN_CLIMB_STRENGTH;
            if (info.botStyle === 'gen26' && g.botThink) return DAYDREAM_ANCHOR;
            return (info.botStyle && BOT_ANCHORS[info.botStyle]) || UNKNOWN_ANCHOR;
        });
        oppSum += (opps[0] + opps[1]) / 2;
        if (!g.assistUsed && !g.counterUsed) clean++;
    }
    const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
    return {
        ranked: n,
        grind: clamp01(n / GRIND_CAP_GAMES),
        winning: clamp01(((sSum / n) - 0.15) / 0.7),
        opposition: clamp01(((oppSum / n) - 1000) / 800),
        clean: clamp01(clean / n),
    };
};

/**
 * Rate the whole family at once — real multiplayer Elo. Human seats
 * resolve to that player's actual skill, iterated to a fixed point
 * (3 passes moves the board <10 SR; pass 1 is the old peer assumption).
 * This is why Tyler's 219 games against half-human tables finally price
 * correctly: his opponents are Nate and Carson, not "someone exactly as
 * good as Tyler".
 */
export const boardSkills = (
    gamesByUid: Record<string, SkillGame[]>,
    passes = 3,
): Record<string, SkillResult> => {
    let board: Record<string, number> = {};
    let results: Record<string, SkillResult> = {};
    for (let p = 0; p < passes; p++) {
        results = {};
        const next: Record<string, number> = {};
        for (const [uid, games] of Object.entries(gamesByUid)) {
            const res = replaySkill(games, board, uid);
            results[uid] = res;
            next[uid] = res.skill;
        }
        board = next;
    }
    return results;
};
