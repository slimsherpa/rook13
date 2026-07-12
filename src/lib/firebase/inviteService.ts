// Table invites: "come sit with us" taps between players.
//
// One doc per (game, recipient) at invites/{gameId_toUid} — resending the
// same invite just refreshes it, so nobody can be spammed with duplicates.
// The recipient sees it live on their home screen and either accepts
// (jump to the table, delete the doc) or declines (delete the doc).
// Invites expire client-side after a day; the doc ids make stale ones
// harmless either way.

import {
    collection, deleteDoc, doc, onSnapshot, query, setDoc, where, Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import { PlayerIdentity } from './gameService';

export interface InviteDoc {
    id: string;
    gameId: string;
    joinCode: string;
    fromUid: string;
    fromName: string;
    fromPhotoURL?: string;
    toUid: string;
    createdAt: number; // epoch ms
}

/** Invites older than this are hidden (the table is long gone). */
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

const inviteRef = (gameId: string, toUid: string) =>
    doc(db, 'invites', `${gameId}_${toUid}`);

export const sendInvite = async (
    game: { id: string; joinCode: string },
    from: PlayerIdentity,
    toUid: string,
): Promise<void> => {
    const invite: InviteDoc = {
        id: `${game.id}_${toUid}`,
        gameId: game.id,
        joinCode: game.joinCode,
        fromUid: from.uid,
        fromName: from.name,
        ...(from.photoURL ? { fromPhotoURL: from.photoURL } : {}),
        toUid,
        createdAt: Date.now(),
    };
    await setDoc(inviteRef(game.id, toUid), invite);
};

/** Accepting and declining both retire the doc; the caller handles navigation. */
export const clearInvite = (invite: InviteDoc): Promise<void> =>
    deleteDoc(doc(db, 'invites', invite.id)).catch(() => { /* already gone is fine */ });

export const subscribeMyInvites = (
    uid: string,
    onChange: (invites: InviteDoc[]) => void,
): Unsubscribe =>
    onSnapshot(
        query(collection(db, 'invites'), where('toUid', '==', uid)),
        (snap) => {
            const cutoff = Date.now() - INVITE_TTL_MS;
            onChange(
                snap.docs
                    .map((d) => d.data() as InviteDoc)
                    .filter((i) => i.createdAt > cutoff)
                    .sort((a, b) => b.createdAt - a.createdAt),
            );
        },
        () => onChange([]), // rules not deployed yet — degrade quietly
    );
