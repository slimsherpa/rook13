// Global lobby presence: who's online right now, hoping for a game.
//
// One heartbeat doc per player at presence/{uid} — the same
// heartbeat/staleness trick as game watchers (gameService.ts), just
// app-wide. Written from the home screen; anyone stale is simply filtered
// out client-side, so there's nothing to clean up server-side.

import { deleteDoc, doc, collection, onSnapshot, setDoc, Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import { PlayerIdentity } from './gameService';

export interface PresenceDoc {
    uid: string;
    name: string;
    photoURL?: string;
    lastSeen: number; // epoch ms
}

export const PRESENCE_HEARTBEAT_MS = 30_000;
export const PRESENCE_STALE_MS = 75_000;

const presenceRef = (uid: string) => doc(db, 'presence', uid);

export const touchPresence = (me: PlayerIdentity): Promise<void> =>
    setDoc(presenceRef(me.uid), {
        uid: me.uid,
        name: me.name,
        ...(me.photoURL ? { photoURL: me.photoURL } : {}),
        lastSeen: Date.now(),
    }).catch(() => { /* transient offline is fine */ });

export const removePresence = (uid: string): Promise<void> =>
    deleteDoc(presenceRef(uid)).catch(() => { /* best effort on tab close */ });

export const subscribePresence = (
    onChange: (online: PresenceDoc[]) => void,
): Unsubscribe =>
    onSnapshot(collection(db, 'presence'), (snap) => {
        const cutoff = Date.now() - PRESENCE_STALE_MS;
        onChange(
            snap.docs
                .map((d) => d.data() as PresenceDoc)
                .filter((p) => p.lastSeen > cutoff)
                .sort((a, b) => b.lastSeen - a.lastSeen),
        );
    });
