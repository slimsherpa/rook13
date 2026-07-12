// User profiles and lifetime stats, stored at users/{uid} with one
// history entry per finished game at users/{uid}/history/{gameId}.

import { collection, doc, getDoc, getDocs, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db } from './firebase';
import { GameDoc, Seat, SEATS, getCardPoints, teamOf } from '../game/types';

export interface UserStats {
    gamesPlayed: number;
    gamesWon: number;
    handsPlayed: number;
    bidsWon: number;
    bidsMade: number;   // bids won that weren't set — the "made its"
    timesSet: number;
    redealsWitnessed: number;
    highestBidMade: number;
    // Trophy-case extras. Older profiles simply lack them (merged over
    // emptyStats() on every update), and hand-deal stats only accrue from
    // games recorded after HandSummary started carrying dealtHands.
    highestBid: number;                    // highest auction won, made or set
    setsDefended: number;                  // opposing bidder went set on your watch
    maxHandPoints: number;                 // most count dealt in one hand (4 tens + a 5 = 45!)
    zeroCountHands: number;                // dealt a hand with zero count
    longestSuit: number;                   // most cards of one suit in a deal
    rainbowCounts: Record<string, number>; // '14' -> times dealt all four 14s
    madeByBid: Record<string, number>;     // '100' -> times you bid 100 and made it
    sweeps: number;                        // hands where your team took all 9 tricks
    pointsCaptured: number;                // lifetime card points your team banked
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
    highestBid: 0,
    setsDefended: 0,
    maxHandPoints: 0,
    zeroCountHands: 0,
    longestSuit: 0,
    rainbowCounts: {},
    madeByBid: {},
    sweeps: 0,
    pointsCaptured: 0,
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

/** Everyone who has ever signed in, most games played first. It's a family
 *  game — profiles are open to all signed-in players by design. */
export const listPlayers = async (): Promise<UserProfile[]> => {
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs
        .map((d) => d.data() as UserProfile)
        .sort((a, b) => (b.stats?.gamesPlayed ?? 0) - (a.stats?.gamesPlayed ?? 0));
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

                // trophy-case extras, hand by hand
                const myTeam = teamOf(seat);
                for (const h of game.handHistory) {
                    stats.pointsCaptured += h.pointsTaken[myTeam];
                    if (h.tricksWon[myTeam] === 9) stats.sweeps += 1;
                    if (teamOf(h.bidWinner) !== myTeam && h.wentSet) stats.setsDefended += 1;
                    if (h.bidWinner === seat) {
                        stats.highestBid = Math.max(stats.highestBid, h.bid);
                        if (!h.wentSet) {
                            const k = String(h.bid);
                            stats.madeByBid[k] = (stats.madeByBid[k] ?? 0) + 1;
                        }
                    }
                    const dealt = h.dealtHands?.[seat];
                    if (dealt && dealt.length > 0) {
                        const pts = dealt.reduce((sum, c) => sum + getCardPoints(c), 0);
                        stats.maxHandPoints = Math.max(stats.maxHandPoints, pts);
                        if (pts === 0) stats.zeroCountHands += 1;
                        const bySuit = new Map<string, number>();
                        const byNumber = new Map<number, number>();
                        for (const c of dealt) {
                            bySuit.set(c.suit, (bySuit.get(c.suit) ?? 0) + 1);
                            byNumber.set(c.number, (byNumber.get(c.number) ?? 0) + 1);
                        }
                        stats.longestSuit = Math.max(stats.longestSuit, ...Array.from(bySuit.values()));
                        for (const [num, count] of Array.from(byNumber.entries())) {
                            if (count === 4) {
                                const k = String(num);
                                stats.rainbowCounts[k] = (stats.rainbowCounts[k] ?? 0) + 1;
                            }
                        }
                    }
                }

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
