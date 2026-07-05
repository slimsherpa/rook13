'use client';

// Live spectator presence for a game.
//
// Everyone at the table subscribes to the watcher list (so seated players see
// who's peeking over their shoulder); only clients WITHOUT a seat announce
// themselves, with a heartbeat that also refreshes when the tab regains
// focus. Stale heartbeats age out client-side — see gameService.

import { useEffect, useState } from 'react';
import {
    WatcherDoc, WATCHER_HEARTBEAT_MS,
    removeWatcher, subscribeWatchers, touchWatcher,
} from '../firebase/gameService';
import { useAuth } from './useAuth';

export const useWatchers = (gameId: string | null, isSpectating: boolean): WatcherDoc[] => {
    const { user } = useAuth();
    const [watchers, setWatchers] = useState<WatcherDoc[]>([]);

    // everyone listens
    useEffect(() => {
        if (!gameId || !user) return;
        return subscribeWatchers(gameId, setWatchers);
    }, [gameId, user]);

    // spectators announce
    useEffect(() => {
        if (!gameId || !user || !isSpectating) return;
        const me = {
            uid: user.uid,
            name: user.displayName || 'Guest',
            ...(user.photoURL ? { photoURL: user.photoURL } : {}),
        };
        const beat = () => touchWatcher(gameId, me).catch(() => {});
        beat();
        const interval = setInterval(beat, WATCHER_HEARTBEAT_MS);
        const onVisible = () => { if (document.visibilityState === 'visible') beat(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisible);
            removeWatcher(gameId, user.uid);
        };
    }, [gameId, user, isSpectating]);

    return watchers;
};
