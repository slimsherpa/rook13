// Ladder ratings, served: fetches players' users/{uid}/history docs
// (readable by any signed-in player, same as profiles) and replays them
// through the pure engine in lib/game/skill.ts.
//
// v2 is board-based: human seats price at that player's actual skill, so
// the whole roster replays together (boardSkills iterates to a fixed
// point). What gets cached per device is each player's PARSED GAME LIST,
// keyed on their (gamesPlayed, gamesWon) counters — those only move when
// a game finishes, so a player's history subcollection is re-read exactly
// once per finished game per device. The replay itself is pure math and
// runs fresh each load (a family-sized board is <10ms).

import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { GameHistoryEntry, UserProfile, listPlayers } from './userService';
import { Seat, SeatInfo } from '../game/types';
import {
    PLACEMENT_GAMES, SKILL_VERSION, START_SKILL,
    SkillGame, SkillResult, boardSkills, replaySkill,
} from '../game/skill';

const cacheKey = (uid: string) => `rook13-hist-v${SKILL_VERSION}-${uid}`;
const freshnessKey = (p: UserProfile) =>
    `${p.stats?.gamesPlayed ?? 0}:${p.stats?.gamesWon ?? 0}`;

/** Keep only what the replay reads — a seat snapshot carries name/photo
 *  strings that would bloat the localStorage cache. */
const slimSeat = (i: SeatInfo | undefined): SeatInfo | undefined =>
    i && {
        kind: i.kind, name: '',
        ...(i.uid ? { uid: i.uid } : {}),
        ...(i.botStyle ? { botStyle: i.botStyle } : {}),
        ...(i.assist ? { assist: true } : {}),
        ...(i.counter ? { counter: true } : {}),
    };

const toSkillGame = (e: GameHistoryEntry): SkillGame | null => {
    if (e.finishedAt === undefined || e.won === undefined) return null;
    const seats = e.seats
        ? Object.fromEntries(Object.entries(e.seats)
            .map(([s, i]) => [s, slimSeat(i as SeatInfo)])) as Record<Seat, SeatInfo>
        : undefined;
    return {
        seat: e.seat,
        seats,
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
    ({ rating: START_SKILL, skill: START_SKILL, ranked: 0, provisional: true });

/** One player's replayable games — localStorage cache first. */
const loadGames = async (p: UserProfile): Promise<SkillGame[]> => {
    const fresh = freshnessKey(p);
    try {
        const raw = localStorage.getItem(cacheKey(p.uid));
        if (raw) {
            const c = JSON.parse(raw) as { fresh: string; games: SkillGame[] };
            if (c.fresh === fresh && Array.isArray(c.games)) return c.games;
        }
    } catch { /* cache unreadable — refetch below */ }

    // no finished games ⇒ nothing to fetch (also keeps brand-new profiles
    // from costing a subcollection read each)
    if ((p.stats?.gamesPlayed ?? 0) === 0) return [];

    const snap = await getDocs(collection(db, 'users', p.uid, 'history'));
    const games = snap.docs
        .map((d) => toSkillGame(d.data() as GameHistoryEntry))
        .filter((g): g is SkillGame => g !== null);
    try {
        localStorage.setItem(cacheKey(p.uid), JSON.stringify({ fresh, games }));
    } catch { /* storage full — refetch next time */ }
    return games;
};

/** Ratings for a roster — the whole board replays together so human
 *  seats price correctly. Players whose history fails to load replay
 *  what loaded (empty ⇒ unranked). */
export const skillForAll = async (
    players: UserProfile[],
): Promise<Record<string, SkillResult>> => {
    const gamesByUid: Record<string, SkillGame[]> = {};
    await Promise.all(players.map(async (p) => {
        try {
            gamesByUid[p.uid] = await loadGames(p);
        } catch {
            gamesByUid[p.uid] = [];
        }
    }));
    return boardSkills(gamesByUid);
};

/** Rating for one player. Human-aware pricing needs the whole board, so
 *  this loads the roster; falls back to a solo replay if that fails. */
export const skillFor = async (p: UserProfile): Promise<SkillResult> => {
    try {
        const board = await skillForAll(await listPlayers());
        const mine = board[p.uid];
        if (mine) return mine;
    } catch { /* roster unavailable — price humans as peers below */ }
    try {
        return replaySkill(await loadGames(p));
    } catch {
        return unrankedSkill();
    }
};

export { PLACEMENT_GAMES };
