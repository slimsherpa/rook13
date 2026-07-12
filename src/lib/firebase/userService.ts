// User profiles and lifetime stats, stored at users/{uid} with one
// history entry per finished game at users/{uid}/history/{gameId}.

import { collection, doc, getDoc, getDocs, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db } from './firebase';
import { GameDoc, Seat, SEATS, teamOf } from '../game/types';
import { UserStats, emptyStats, applyHandStats, applyGameFinalStats } from '../game/stats';

export type { UserStats } from '../game/stats';

export interface UserProfile {
    uid: string;
    displayName: string;
    photoURL: string | null;
    createdAt: unknown;
    stats: UserStats;
    /**
     * Real-world JAY CUP championship years, e.g. [2026]. The app never
     * writes this — Riley grants it by hand in the Firebase console
     * (Firestore → users → the winner's doc → add field `jayCupYears`,
     * type array of numbers) for verified winners only. The Trophy Case
     * renders it as the crown jewel.
     */
    jayCupYears?: number[];
}

const userRef = (uid: string) => doc(db, 'users', uid);

/** Create the profile on first sign-in; refresh name/photo on later ones. */
export const ensureUserProfile = async (user: User): Promise<void> => {
    const ref = userRef(user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
        const profile: UserProfile = {
            uid: user.uid,
            displayName: user.displayName || 'Player',
            photoURL: user.photoURL || null,
            createdAt: serverTimestamp(),
            stats: emptyStats(),
        };
        await setDoc(ref, profile);
    } else {
        await setDoc(ref, {
            displayName: user.displayName || 'Player',
            photoURL: user.photoURL || null,
        }, { merge: true });
    }
};

export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
    const snap = await getDoc(userRef(uid));
    return snap.exists() ? (snap.data() as UserProfile) : null;
};

/** Everyone who has ever signed in, most games played first. It's a family
 *  game — profiles are open to all signed-in players by design. */
export const listPlayers = async (): Promise<UserProfile[]> => {
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs
        .map((d) => d.data() as UserProfile)
        .sort((a, b) => (b.stats?.gamesPlayed ?? 0) - (a.stats?.gamesPlayed ?? 0));
};

/**
 * Fold a game's finished hands into the signed-in player's lifetime stats —
 * incrementally, as they happen, so the Trophy Case updates mid-game instead
 * of waiting for the final whistle. Idempotent and safe to call on every
 * snapshot: the per-game history doc tracks `handsRecorded` (and `final`), so
 * each hand is counted exactly once no matter how many times or from how many
 * devices this runs. Each client records only itself, keeping the security
 * rules owner-only; players offline at the finish catch up next time they
 * open the game.
 *
 * History docs written by the pre-incremental code have no `handsRecorded`
 * field — those games were recorded whole, so they're left alone.
 */
export const recordGameStats = async (game: GameDoc, uid: string): Promise<void> => {
    if (game.handHistory.length === 0) return;

    const seat = SEATS.find((s) => {
        const info = game.seats[s];
        return info.kind === 'human' && info.uid === uid;
    });
    if (!seat) return;

    const historyRef = doc(db, 'users', uid, 'history', game.id);
    const isComplete = game.status === 'completed' && !!game.winner;

    try {
        await runTransaction(db, async (tx) => {
            const [histSnap, userSnap] = await Promise.all([
                tx.get(historyRef),
                tx.get(userRef(uid)),
            ]);
            const hist = histSnap.exists()
                ? (histSnap.data() as { handsRecorded?: number; final?: boolean })
                : undefined;
            if (hist && hist.handsRecorded === undefined) return; // legacy: recorded whole
            const handsRecorded = hist?.handsRecorded ?? 0;
            const final = hist?.final ?? false;
            const newHands = game.handHistory.slice(handsRecorded);
            if (newHands.length === 0 && (final || !isComplete)) return; // nothing new

            const stats: UserStats = userSnap.exists()
                ? { ...emptyStats(), ...(userSnap.data() as UserProfile).stats }
                : emptyStats();

            for (const h of newHands) applyHandStats(stats, h, seat);
            if (isComplete && !final) applyGameFinalStats(stats, game, seat);

            tx.set(historyRef, {
                gameId: game.id,
                seat,
                team: teamOf(seat),
                scores: game.scores,
                hands: game.handHistory.length,
                seats: game.seats,
                handsRecorded: game.handHistory.length,
                final: final || isComplete,
                ...(isComplete ? { finishedAt: game.updatedAt, won: teamOf(seat) === game.winner } : {}),
            }, { merge: true });
            tx.set(userRef(uid), { stats }, { merge: true });
        });
    } catch {
        // best-effort; a concurrent update from another device wins the race
    }
};
