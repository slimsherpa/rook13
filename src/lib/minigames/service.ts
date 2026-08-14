// Beat the Bot progress — one doc per mini-game per player at
// users/{uid}/minigames/{game}, owner-written like history docs.
// Reads are open to all signed-in players so the Trophy Case can show
// anyone's training record (family-game policy, same as everything else).

import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { Grade } from './scoring';
import { MiniGameKey, MiniGameProgress, emptyProgress } from './types';

const progressRef = (uid: string, game: MiniGameKey) =>
    doc(db, 'users', uid, 'minigames', game);

export const getProgress = async (
    uid: string, game: MiniGameKey,
): Promise<MiniGameProgress> => {
    const snap = await getDoc(progressRef(uid, game));
    return snap.exists()
        ? { ...emptyProgress(game), ...(snap.data() as MiniGameProgress) }
        : emptyProgress(game);
};

export const listAllProgress = async (
    uid: string,
): Promise<MiniGameProgress[]> => {
    const snap = await getDocs(collection(db, 'users', uid, 'minigames'));
    return snap.docs.map((d) => ({
        ...emptyProgress(d.id as MiniGameKey),
        ...(d.data() as MiniGameProgress),
    }));
};

/** Fold one graded attempt into progress and persist. Returns the new
 *  progress object (the caller keeps it as local state — last writer
 *  wins across devices, which is fine for a solo drill). */
export const recordAttempt = async (
    uid: string, prev: MiniGameProgress, itemId: number, grade: Grade,
): Promise<MiniGameProgress> => {
    if (prev.done.includes(itemId)) return prev;   // replays don't re-count
    const hit = grade.tier === 'perfect' || grade.tier === 'close';
    const streak = hit ? prev.streak + 1 : 0;
    const next: MiniGameProgress = {
        ...prev,
        attempts: prev.attempts + 1,
        perfect: prev.perfect + (grade.tier === 'perfect' ? 1 : 0),
        close: prev.close + (grade.tier === 'close' ? 1 : 0),
        points: prev.points + grade.points,
        streak,
        bestStreak: Math.max(prev.bestStreak, streak),
        done: [...prev.done, itemId],
        updatedAt: Date.now(),
    };
    try {
        await setDoc(progressRef(uid, prev.game), next);
    } catch {
        // offline: Firestore's persistent cache will sync it later
    }
    return next;
};
