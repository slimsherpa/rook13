// User profiles and lifetime stats, stored at users/{uid} with one
// history entry per finished game at users/{uid}/history/{gameId}.

import { doc, getDoc, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db } from './firebase';
import { GameDoc, Seat, SEATS, teamOf } from '../game/types';

export interface UserStats {
    gamesPlayed: number;
    gamesWon: number;
    handsPlayed: number;
    bidsWon: number;
    bidsMade: number;   // bids won that weren't set
    timesSet: number;
    redealsWitnessed: number;
    highestBidMade: number;
}

export interface UserProfile {
    uid: string;
    displayName: string;
    photoURL: string | null;
    createdAt: unknown;
    stats: UserStats;
}

const emptyStats = (): UserStats => ({
    gamesPlayed: 0,
    gamesWon: 0,
    handsPlayed: 0,
    bidsWon: 0,
    bidsMade: 0,
    timesSet: 0,
    redealsWitnessed: 0,
    highestBidMade: 0,
});

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

/**
 * Record a completed game into the signed-in player's own stats. Idempotent:
 * the per-game history doc acts as the "already recorded" marker. Each client
 * records only itself, so security rules can stay owner-only; players who
 * were offline at the finish get recorded next time they open the game.
 */
export const recordCompletedGame = async (game: GameDoc, uid: string): Promise<void> => {
    if (game.status !== 'completed' || !game.winner) return;

    const seat = SEATS.find((s) => {
        const info = game.seats[s];
        return info.kind === 'human' && info.uid === uid;
    });
    if (!seat) return;

    {
        const historyRef = doc(db, 'users', uid, 'history', game.id);

        try {
            await runTransaction(db, async (tx) => {
                const [histSnap, userSnap] = await Promise.all([
                    tx.get(historyRef),
                    tx.get(userRef(uid)),
                ]);
                if (histSnap.exists()) return; // already recorded

                const won = teamOf(seat) === game.winner;
                const myBidHands = game.handHistory.filter((h) => h.bidWinner === seat);
                const stats: UserStats = userSnap.exists()
                    ? { ...emptyStats(), ...(userSnap.data() as UserProfile).stats }
                    : emptyStats();

                stats.gamesPlayed += 1;
                if (won) stats.gamesWon += 1;
                stats.handsPlayed += game.handHistory.length;
                stats.bidsWon += myBidHands.length;
                stats.bidsMade += myBidHands.filter((h) => !h.wentSet).length;
                stats.timesSet += myBidHands.filter((h) => h.wentSet).length;
                stats.redealsWitnessed += game.redealCount;
                stats.highestBidMade = Math.max(
                    stats.highestBidMade,
                    ...myBidHands.filter((h) => !h.wentSet).map((h) => h.bid),
                    0,
                );

                tx.set(historyRef, {
                    gameId: game.id,
                    finishedAt: game.updatedAt,
                    seat,
                    team: teamOf(seat),
                    won,
                    scores: game.scores,
                    hands: game.handHistory.length,
                    seats: game.seats,
                });
                tx.set(userRef(uid), { stats }, { merge: true });
            });
        } catch {
            // best-effort; another client likely recorded it first
        }
    }
};
