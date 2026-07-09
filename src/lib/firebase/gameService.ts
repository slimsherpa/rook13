// Firestore game persistence.
//
// One document per game at games/{gameId} holding the full engine state plus
// an action log subcollection for replay/history. Every move goes through a
// transaction that re-validates the action against the engine and bumps
// actionCount, so two clients (or a client and a bot runner) can never apply
// conflicting moves.

import {
    collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query,
    runTransaction, setDoc, where, Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import { GameDoc, GameAction, Seat } from '../game/types';
import { createGameDoc, applyAction, InvalidActionError } from '../game/engine';

const GAMES = 'games';

const gameRef = (id: string) => doc(db, GAMES, id);
const actionsRef = (id: string) => collection(db, GAMES, id, 'actions');

const randomId = (): string => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 20 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

/** 4-letter join codes: easy to shout across a room. */
const randomJoinCode = (): string => {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I/L/O — too easy to misread
    return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

export interface PlayerIdentity {
    uid: string;
    name: string;
    photoURL?: string;
}

export const createGame = async (host: PlayerIdentity): Promise<GameDoc> => {
    const id = randomId();
    const game = createGameDoc({ id, joinCode: randomJoinCode(), host });
    await setDoc(gameRef(id), game);
    return game;
};

export const getGame = async (id: string): Promise<GameDoc | null> => {
    const snap = await getDoc(gameRef(id));
    return snap.exists() ? (snap.data() as GameDoc) : null;
};

// NOTE: list queries below use single-field filters only and sort client-side,
// so they work with Firestore's automatic indexes (no composite index deploys).

export const findGameByCode = async (code: string): Promise<GameDoc | null> => {
    const q = query(
        collection(db, GAMES),
        where('joinCode', '==', code.toUpperCase().trim()),
        limit(25),
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const games = snap.docs.map((d) => d.data() as GameDoc);
    // prefer joinable lobbies, then the most recent match
    games.sort((a, b) => {
        if ((a.status === 'lobby') !== (b.status === 'lobby')) {
            return a.status === 'lobby' ? -1 : 1;
        }
        return b.createdAt - a.createdAt;
    });
    return games[0];
};

export interface GameSnapshotMeta {
    /** true while this data comes from the local cache, not the live server */
    fromCache: boolean;
    hasPendingWrites: boolean;
}

export const subscribeGame = (
    id: string,
    onChange: (game: GameDoc | null, meta: GameSnapshotMeta) => void,
    onError?: (error: Error) => void,
): Unsubscribe =>
    onSnapshot(
        gameRef(id),
        // metadata changes tell us when the listener falls back to cached
        // data (connection lost) and when it's back in sync with the server
        { includeMetadataChanges: true },
        (snap) => {
            onChange(snap.exists() ? (snap.data() as GameDoc) : null, {
                fromCache: snap.metadata.fromCache,
                hasPendingWrites: snap.metadata.hasPendingWrites,
            });
        },
        (error) => {
            console.error('game subscription failed', error);
            onError?.(error);
        },
    );

/** Human-readable message for Firestore/engine errors, with a setup hint. */
export const describeFirestoreError = (e: unknown): string => {
    const err = e as { code?: string; message?: string };
    if (err?.code === 'permission-denied' || /insufficient permissions/i.test(err?.message ?? '')) {
        return 'Firestore denied the request — the security rules in firestore.rules are '
            + 'probably not deployed yet (npx firebase-tools deploy --only firestore).';
    }
    if (err?.code === 'unavailable' || err?.code === 'deadline-exceeded') {
        return "Couldn't reach the game server — check your connection and try again.";
    }
    return err?.message || 'Something went wrong';
};

/**
 * Apply a game action atomically. Validation runs inside the transaction on
 * the freshest state, so stale/duplicate submissions fail cleanly.
 *
 * `expectedActionCount` (optional) turns "apply" into "apply only if nothing
 * happened since I looked" — the bot runner uses it so several clients can
 * race to move the same bot and exactly one wins.
 */
export const submitAction = async (
    gameId: string,
    action: GameAction,
    by: string,
    expectedActionCount?: number,
): Promise<GameDoc> => {
    return runTransaction(db, async (tx) => {
        const snap = await tx.get(gameRef(gameId));
        if (!snap.exists()) throw new Error('Game not found');
        const game = snap.data() as GameDoc;

        if (expectedActionCount !== undefined && game.actionCount !== expectedActionCount) {
            throw new StaleActionError('Game state changed');
        }

        const next = applyAction(game, action); // throws InvalidActionError when illegal
        tx.set(gameRef(gameId), next);
        tx.set(doc(actionsRef(gameId), String(next.actionCount).padStart(6, '0')), {
            index: next.actionCount,
            at: next.updatedAt,
            action,
            by,
        });
        return next;
    });
};

export class StaleActionError extends Error {}

export const isExpectedRaceError = (e: unknown): boolean =>
    e instanceof StaleActionError || e instanceof InvalidActionError;

/** Games this player is seated in, most recently touched first. */
export const listMyGames = async (uid: string, max = 25): Promise<GameDoc[]> => {
    const q = query(
        collection(db, GAMES),
        where('playerUids', 'array-contains', uid),
        limit(100),
    );
    const snap = await getDocs(q);
    return snap.docs
        .map((d) => d.data() as GameDoc)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, max);
};

/** Open lobbies anyone can join, newest first. */
export const listOpenGames = async (max = 20): Promise<GameDoc[]> => {
    const q = query(
        collection(db, GAMES),
        where('status', '==', 'lobby'),
        limit(50),
    );
    const snap = await getDocs(q);
    return snap.docs
        .map((d) => d.data() as GameDoc)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, max);
};

export const loadActionLog = async (gameId: string) => {
    const snap = await getDocs(query(actionsRef(gameId), orderBy('index', 'asc')));
    return snap.docs.map((d) => d.data());
};

// Spectator presence ---------------------------------------------------------
//
// Watchers announce themselves with a heartbeat doc at
// games/{id}/watchers/{uid}. A watcher is "live" while its lastSeen is fresh;
// stale docs are ignored client-side (and overwritten on the next visit), so
// no server-side cleanup is needed.

export interface WatcherDoc {
    uid: string;
    name: string;
    photoURL?: string;
    lastSeen: number; // epoch ms
}

/** How often a spectator refreshes their heartbeat. */
export const WATCHER_HEARTBEAT_MS = 30_000;
/** A watcher whose heartbeat is older than this is considered gone. */
export const WATCHER_STALE_MS = 75_000;

const watcherRef = (gameId: string, uid: string) => doc(db, GAMES, gameId, 'watchers', uid);

export const touchWatcher = (gameId: string, watcher: PlayerIdentity): Promise<void> =>
    setDoc(watcherRef(gameId, watcher.uid), {
        uid: watcher.uid,
        name: watcher.name,
        ...(watcher.photoURL ? { photoURL: watcher.photoURL } : {}),
        lastSeen: Date.now(),
    });

export const removeWatcher = (gameId: string, uid: string): Promise<void> =>
    deleteDoc(watcherRef(gameId, uid)).catch(() => { /* best effort on tab close */ });

export const subscribeWatchers = (
    gameId: string,
    onChange: (watchers: WatcherDoc[]) => void,
): Unsubscribe =>
    onSnapshot(collection(db, GAMES, gameId, 'watchers'), (snap) => {
        const cutoff = Date.now() - WATCHER_STALE_MS;
        onChange(
            snap.docs
                .map((d) => d.data() as WatcherDoc)
                .filter((w) => w.lastSeen > cutoff)
                .sort((a, b) => b.lastSeen - a.lastSeen),
        );
    });

// Convenience wrappers -------------------------------------------------------

export const sitAt = (gameId: string, seat: Seat, player: PlayerIdentity) =>
    submitAction(gameId, { type: 'SIT', seat, player }, player.uid);

export const leaveSeat = (gameId: string, seat: Seat, uid: string) =>
    submitAction(gameId, { type: 'LEAVE_SEAT', seat, uid }, uid);

export const setBot = (gameId: string, seat: Seat, byUid: string) =>
    submitAction(gameId, { type: 'SET_BOT', seat, botStyle: 'gen8' }, byUid);

export const openSeat = (gameId: string, seat: Seat, byUid: string) =>
    submitAction(gameId, { type: 'OPEN_SEAT', seat }, byUid);

export const startGame = (gameId: string, byUid: string) =>
    submitAction(gameId, { type: 'START_GAME' }, byUid);
