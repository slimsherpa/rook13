// Ladder ratings, served: fetches a player's users/{uid}/history docs
// (readable by any signed-in player, same as profiles) and replays them
// through the pure engine in lib/game/skill.ts.
//
// Cost control for the leaderboard: the replay result is cached in
// localStorage keyed on the player's (gamesPlayed, gamesWon) counters —
// those only move when a game finishes, so a player's history subcollection
// is re-read exactly once per finished game per device. A family-sized
// board is a handful of reads on a warm cache.

import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { GameHistoryEntry, UserProfile } from './userService';
import {
    PLACEMENT_GAMES, SKILL_VERSION, START_SKILL,
    SkillGame, SkillResult, replaySkill,
} from '../game/skill';

const cacheKey = (uid: string) => `rook13-skill-v${SKILL_VERSION}-${uid}`;
const freshnessKey = (p: UserProfile) =>
    `${p.stats?.gamesPlayed ?? 0}:${p.stats?.gamesWon ?? 0}`;

const toSkillGame = (e: GameHistoryEntry): SkillGame | null => {
    if (e.finishedAt === undefined || e.won === undefined) return null;
    return {
        seat: e.seat,
        seats: e.seats,
        scores: e.scores,
        won: e.won,
        finishedAt: typeof e.finishedAt === 'number' ? e.finishedAt : 0,
        botThink: e.botThink,
        // explicit flags from 2026-08 on; older docs fall back to the seat
        // snapshot (the toggle state as of the game's last recorded hand)
        assistUsed: e.assistUsed ?? e.seats?.[e.seat]?.assist,
        counterUsed: e.counterUsed ?? e.seats?.[e.seat]?.counter,
    };
};

export const unrankedSkill = (): SkillResult =>
    ({ rating: START_SKILL, ranked: 0, provisional: true });

/** Rating for one player — localStorage cache first, replay on miss. */
export const skillFor = async (p: UserProfile): Promise<SkillResult> => {
    const fresh = freshnessKey(p);
    try {
        const raw = localStorage.getItem(cacheKey(p.uid));
        if (raw) {
            const c = JSON.parse(raw) as { fresh: string; result: SkillResult };
            if (c.fresh === fresh && c.result) return c.result;
        }
    } catch { /* cache unreadable — replay below */ }

    // no finished games ⇒ nothing to fetch (also keeps brand-new profiles
    // from costing a subcollection read each)
    if ((p.stats?.gamesPlayed ?? 0) === 0) return unrankedSkill();

    let result: SkillResult;
    try {
        const snap = await getDocs(collection(db, 'users', p.uid, 'history'));
        const games = snap.docs
            .map((d) => toSkillGame(d.data() as GameHistoryEntry))
            .filter((g): g is SkillGame => g !== null);
        result = replaySkill(games);
    } catch {
        return unrankedSkill();   // offline/denied — don't poison the cache
    }
    try {
        localStorage.setItem(cacheKey(p.uid), JSON.stringify({ fresh, result }));
    } catch { /* storage full — recompute next time */ }
    return result;
};

/** Ratings for a roster, in parallel (family-sized lists). */
export const skillForAll = async (
    players: UserProfile[],
): Promise<Record<string, SkillResult>> => {
    const out: Record<string, SkillResult> = {};
    await Promise.all(players.map(async (p) => { out[p.uid] = await skillFor(p); }));
    return out;
};

export { PLACEMENT_GAMES };
