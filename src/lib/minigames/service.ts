// Beat the Bot progress — one doc per mini-game per player at
// users/{uid}/minigames/{game}, owner-written like history docs.
// Reads are open to all signed-in players so the Trophy Case can show
// anyone's training record (family-game policy, same as everything else).
//
// Every read and write is mirrored in localStorage, and Firestore
// failures are swallowed: the drills keep working offline or before the
// minigames security rule is deployed, and the doc syncs up on the next
// successful write. Last writer wins across devices — fine for a solo
// drill.

import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { Grade } from './scoring';
import { MiniGameKey, MiniGameProgress, emptyProgress } from './types';

const progressRef = (uid: string, game: MiniGameKey) =>
    doc(db, 'users', uid, 'minigames', game);

const localKey = (uid: string, game: MiniGameKey) => `mg_${uid}_${game}`;

const readLocal = (uid: string, game: MiniGameKey): MiniGameProgress | null => {
    try {
        const raw = localStorage.getItem(localKey(uid, game));
        return raw ? { ...emptyProgress(game), ...JSON.parse(raw) } : null;
    } catch {
        return null;
    }
};

const writeLocal = (uid: string, p: MiniGameProgress) => {
    try {
        localStorage.setItem(localKey(uid, p.game), JSON.stringify(p));
    } catch { /* storage full/blocked — Firestore still has it */ }
};

/** Firestore first, localStorage fallback; whichever is further along
 *  wins (covers the pre-rules-deploy window and offline sessions). */
export const getProgress = async (
    uid: string, game: MiniGameKey,
): Promise<MiniGameProgress> => {
    const local = readLocal(uid, game);
    let remote: MiniGameProgress | null = null;
    try {
        const snap = await getDoc(progressRef(uid, game));
        if (snap.exists()) {
            remote = { ...emptyProgress(game), ...(snap.data() as MiniGameProgress) };
        }
    } catch { /* rules not deployed yet / offline */ }
    if (remote && local) return remote.attempts >= local.attempts ? remote : local;
    return remote ?? local ?? emptyProgress(game);
};

export const listAllProgress = async (
    uid: string,
): Promise<MiniGameProgress[]> => {
    try {
        const snap = await getDocs(collection(db, 'users', uid, 'minigames'));
        if (snap.docs.length > 0) {
            return snap.docs.map((d) => ({
                ...emptyProgress(d.id as MiniGameKey),
                ...(d.data() as MiniGameProgress),
            }));
        }
    } catch { /* fall through to local */ }
    return (['godown', 'lead'] as MiniGameKey[])
        .map((g) => readLocal(uid, g))
        .filter((p): p is MiniGameProgress => !!p);
};

/** Fold one graded attempt into progress and persist (localStorage
 *  synchronously, Firestore best-effort). Returns the new progress for
 *  the caller's local state. */
export const recordAttempt = (
    uid: string, prev: MiniGameProgress, itemId: number, grade: Grade,
): MiniGameProgress => {
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
        selTotal: prev.selTotal + grade.selTotal,
        selMatch: prev.selMatch + grade.selMatch,
        done: [...prev.done, itemId],
        updatedAt: Date.now(),
    };
    writeLocal(uid, next);
    setDoc(progressRef(uid, prev.game), next).catch(() => {
        // rules not deployed yet / offline: localStorage carries it and a
        // later successful write ships the full doc
    });
    return next;
};
