// Blunder reports live at games/{gameId}/blunders/{blunderId} — append-only,
// like the action log. Each report pins one action in one hand (see
// BlunderTarget); the training pipeline joins it against the game's action log
// to rebuild the exact decision point. Anyone who can see the game can file
// one; only the reporter can retract their own.

import {
    collection, deleteDoc, doc, onSnapshot, setDoc, Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import { BlunderTarget } from '../game/blunders';

export interface BlunderDoc {
    id: string;
    gameId: string;
    handNumber: number;
    /** the exact action being flagged */
    target: BlunderTarget;
    /** who made the flagged move, as displayed at report time */
    seatName: string;
    seatIsBot: boolean;
    reporter: { uid: string; name: string };
    /** the reporter's own words — what went wrong / what was better ('' if skipped) */
    reason: string;
    createdAt: number; // epoch ms
}

const blundersRef = (gameId: string) => collection(db, 'games', gameId, 'blunders');

export const submitBlunder = async (
    report: Omit<BlunderDoc, 'id' | 'createdAt'>,
): Promise<BlunderDoc> => {
    const ref = doc(blundersRef(report.gameId));
    const full: BlunderDoc = { ...report, id: ref.id, createdAt: Date.now() };
    await setDoc(ref, full);
    return full;
};

/** The reporter changing their mind — allowed only on their own reports. */
export const retractBlunder = (gameId: string, blunderId: string): Promise<void> =>
    deleteDoc(doc(blundersRef(gameId), blunderId));

export const subscribeBlunders = (
    gameId: string,
    onChange: (reports: BlunderDoc[]) => void,
): Unsubscribe =>
    onSnapshot(
        blundersRef(gameId),
        (snap) => {
            onChange(
                snap.docs
                    .map((d) => d.data() as BlunderDoc)
                    .sort((a, b) => a.createdAt - b.createdAt),
            );
        },
        // signed-out contexts (the /dev sandbox) just see no reports
        (error) => console.warn('blunder subscription failed', error),
    );
