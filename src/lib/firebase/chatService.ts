// Chat, twice over:
//
// 1. LOBBY chat — one big family group chat at lobbyChat/{msgId}, visible
//    to everyone on the home screen.
// 2. TABLE chat — per-game quick messages at games/{id}/chat/{msgId},
//    rendered as speech bubbles at the table.
//
// Both are append-only (create-only rules): every message is kept forever
// so table talk can be audited for signaling — Grandma's rules. Character
// caps keep bubbles displayable and honest.

import {
    addDoc, collection, limit, onSnapshot, orderBy, query, serverTimestamp,
    Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import { Seat } from '../game/types';

export const LOBBY_MSG_MAX = 200;
export const TABLE_MSG_MAX = 80;

/** Canned table talk — one tap, zero typing, mobile-first. */
export const QUICK_MESSAGES = [
    'Nice one! 👏',
    'Ouch. 😬',
    'Lucky deal…',
    'I had to. 🤷',
    'Rook13! 🐦',
    'Hurry up! ⏰',
    'gg',
    'Revenge next hand.',
];

export interface ChatMessage {
    id: string;
    uid: string;
    name: string;
    text: string;
    /** seat the sender occupied when talking at a table (lobby msgs omit it) */
    seat?: Seat;
    /** epoch ms (client clock; ordering uses the server timestamp) */
    at: number;
}

const clean = (text: string, max: number): string => text.trim().slice(0, max);

// ---- lobby ----------------------------------------------------------------

export const sendLobbyMessage = async (me: { uid: string; name: string }, text: string): Promise<void> => {
    const t = clean(text, LOBBY_MSG_MAX);
    if (!t) return;
    await addDoc(collection(db, 'lobbyChat'), {
        uid: me.uid, name: me.name, text: t, at: Date.now(), serverAt: serverTimestamp(),
    });
};

export const subscribeLobbyChat = (
    onChange: (msgs: ChatMessage[]) => void,
): Unsubscribe =>
    onSnapshot(query(collection(db, 'lobbyChat'), orderBy('serverAt', 'desc'), limit(50)), (snap) => {
        onChange(
            snap.docs
                .map((d) => ({ id: d.id, ...(d.data() as Omit<ChatMessage, 'id'>) }))
                .reverse(), // oldest first for rendering
        );
    });

// ---- table ----------------------------------------------------------------

export const sendTableMessage = async (
    gameId: string,
    me: { uid: string; name: string },
    text: string,
    seat?: Seat | null,
): Promise<void> => {
    const t = clean(text, TABLE_MSG_MAX);
    if (!t) return;
    await addDoc(collection(db, 'games', gameId, 'chat'), {
        uid: me.uid, name: me.name, text: t, at: Date.now(), serverAt: serverTimestamp(),
        ...(seat ? { seat } : {}),
    });
};

export const subscribeTableChat = (
    gameId: string,
    onChange: (msgs: ChatMessage[]) => void,
): Unsubscribe =>
    onSnapshot(query(collection(db, 'games', gameId, 'chat'), orderBy('serverAt', 'desc'), limit(30)), (snap) => {
        onChange(
            snap.docs
                .map((d) => ({ id: d.id, ...(d.data() as Omit<ChatMessage, 'id'>) }))
                .reverse(),
        );
    });
