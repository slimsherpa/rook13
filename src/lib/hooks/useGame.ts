'use client';

// Live game subscription + optimistic local actions + the bot runner.
//
// Reads: every client watches games/{id}. Writes: the player's own action is
// applied to local state the instant they act — the engine is pure, so we run
// the exact applyAction the server transaction will — and submitted in the
// background. Each snapshot reconciles the overlay: pending actions the
// server has caught up with drop out, and a submission that truly fails
// (offline, rules) rolls back visibly instead of leaving a ghost card.
//
// Bots: when it's a bot's turn each client schedules the bot's move with a
// small stagger (host first, everyone else as fallback). submitAction's
// optimistic-concurrency check guarantees exactly one submission wins, so a
// host closing their phone never stalls the bots for long. The bot runner
// works strictly from confirmed server state, never the optimistic overlay.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GameDoc, GameAction, Seat, SEATS } from '../game/types';
import { validateAction } from '../game/engine';
import { nextAgentActionAsync, preloadNets } from '../alpharook/agent';
import { overlayPending, sameAction, PendingAction } from '../game/optimistic';
import { subscribeGame, submitAction, isExpectedRaceError, describeFirestoreError } from '../firebase/gameService';
import { recordCompletedGame } from '../firebase/userService';
import { useAuth } from './useAuth';

const BOT_BASE_DELAY_MS = 1100;      // natural pacing for bot moves
const BOT_DEAL_DELAY_MS = 1400;
const BOT_REDEAL_PAUSE_MS = 6500;    // let the redeal celebration breathe
// leading the next trick waits out the linger + capture sweep of the last one
const BOT_TRICK_LEAD_DELAY_MS = 3200;
const FALLBACK_EXTRA_MS = 2500;      // non-host clients wait longer before covering

export interface UseGameResult {
    game: GameDoc | null;
    loading: boolean;
    error: string | null;
    /** seat of the signed-in user, or null (spectator) */
    mySeat: Seat | null;
    isHost: boolean;
    act: (action: GameAction) => Promise<void>;
    /** last action error (e.g. a failed submission), cleared on success */
    actionError: string | null;
    /** false while the live listener is serving cached data (offline / reconnecting) */
    synced: boolean;
    /** local actions applied optimistically but not yet confirmed by the server */
    pendingCount: number;
}

export const useGame = (gameId: string | null): UseGameResult => {
    const { user } = useAuth();
    const [serverGame, setServerGame] = useState<GameDoc | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [synced, setSynced] = useState(true);
    const botTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ---- optimistic overlay bookkeeping ----
    // The list lives in a ref (act() mutates it between renders); the version
    // counter is what actually triggers re-renders when it changes.
    const pendingRef = useRef<PendingAction[]>([]);
    const [pendingVersion, setPendingVersion] = useState(0);
    const nextPendingId = useRef(1);

    useEffect(() => {
        if (!gameId) {
            setLoading(false);
            return;
        }
        setLoading(true);
        pendingRef.current = []; // no stale overlay across game switches
        const unsub = subscribeGame(
            gameId,
            (g, meta) => {
                setSynced(!meta.fromCache);
                if (g) {
                    // metadata-only events repeat the same doc — keep the old
                    // object so downstream effects don't refire for nothing
                    setServerGame((prev) => (prev && prev.actionCount === g.actionCount ? prev : g));
                    setError(null);
                    setLoading(false);
                } else if (!meta.fromCache) {
                    // only the server can declare a game missing; a local
                    // cache miss just means we're still connecting
                    setServerGame(null);
                    setError('Game not found');
                    setLoading(false);
                }
            },
            (e) => {
                setLoading(false);
                setError(describeFirestoreError(e));
            },
        );
        return unsub;
    }, [gameId]);

    // retire pending actions the latest server state has caught up with
    useEffect(() => {
        if (!serverGame || pendingRef.current.length === 0) return;
        const { survivors } = overlayPending(serverGame, pendingRef.current);
        if (survivors.length !== pendingRef.current.length) {
            pendingRef.current = survivors;
            setPendingVersion((v) => v + 1);
        }
    }, [serverGame, pendingVersion]);

    // what the player sees: confirmed state + their in-flight actions
    const game = useMemo(() => {
        if (!serverGame) return null;
        if (pendingRef.current.length === 0) return serverGame;
        return overlayPending(serverGame, pendingRef.current).game;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [serverGame, pendingVersion]);

    const displayedRef = useRef(game);
    displayedRef.current = game;

    const mySeat: Seat | null = (() => {
        if (!game || !user) return null;
        for (const s of SEATS) {
            const info = game.seats[s];
            if (info.kind === 'human' && info.uid === user.uid) return s;
        }
        return null;
    })();

    const isHost = !!(game && user && game.hostUid === user.uid);

    const act = useCallback(async (action: GameAction) => {
        if (!gameId || !user) return;

        // double-tap protection: this exact action is already on its way
        if (pendingRef.current.some((p) => sameAction(p.action, action))) return;

        // Validate against what the player is seeing. An action illegal here
        // would be rejected by the server transaction anyway (and swallowed
        // as an expected race), so dying silently matches the old behavior —
        // just without the network round-trip.
        const base = displayedRef.current;
        if (base && validateAction(base, action) !== null) return;

        const entry: PendingAction = { id: nextPendingId.current++, action };
        pendingRef.current = [...pendingRef.current, entry];
        setPendingVersion((v) => v + 1);
        setActionError(null);

        try {
            const next = await submitAction(gameId, action, user.uid);
            // remember which server version contains this action; the overlay
            // keeps covering until a snapshot with that version arrives, so
            // the UI never flashes back to the pre-action state
            entry.confirmedCount = next.actionCount;
            setPendingVersion((v) => v + 1);
        } catch (e: any) {
            // roll the optimistic move back
            pendingRef.current = pendingRef.current.filter((p) => p !== entry);
            setPendingVersion((v) => v + 1);
            if (!isExpectedRaceError(e)) {
                setActionError(describeFirestoreError(e));
            }
        }
    }, [gameId, user]);

    // ---- bot runner (always off confirmed server state) ----
    useEffect(() => {
        if (botTimer.current) {
            clearTimeout(botTimer.current);
            botTimer.current = null;
        }
        if (!serverGame || !gameId || !user || serverGame.status !== 'active') return;
        if (!mySeat && !isHost) return; // spectators never drive bots

        // warm the neural-bot weight cache so the first bid doesn't wait on it
        preloadNets(serverGame);

        // Computing the move may await weight loading (neural bots), so the
        // pacing timer is armed once the action is known; a newer snapshot
        // cancels both the wait and the timer.
        let cancelled = false;
        (async () => {
            const action = await nextAgentActionAsync(serverGame);
            if (cancelled || !action) return;

            const leadsNextTrick =
                action.type === 'PLAY_CARD' &&
                serverGame.trickPlays.length === 0 &&
                serverGame.completedTricks.length > 0;
            const baseDelay =
                action.type === 'ACK_REDEAL' ? BOT_REDEAL_PAUSE_MS :
                action.type === 'DEAL' ? BOT_DEAL_DELAY_MS :
                leadsNextTrick ? BOT_TRICK_LEAD_DELAY_MS :
                BOT_BASE_DELAY_MS;
            const jitter = Math.random() * 400;
            const delay = baseDelay + jitter + (isHost ? 0 : FALLBACK_EXTRA_MS);
            const expected = serverGame.actionCount;

            botTimer.current = setTimeout(async () => {
                try {
                    await submitAction(gameId, action, 'bot', expected);
                } catch (e) {
                    if (!isExpectedRaceError(e)) console.error('bot move failed', e);
                }
            }, delay);
        })();

        return () => {
            cancelled = true;
            if (botTimer.current) clearTimeout(botTimer.current);
        };
    }, [serverGame, gameId, user, mySeat, isHost]);

    // ---- stats recording on completion (confirmed state only) ----
    const recordedRef = useRef(false);
    useEffect(() => {
        if (!serverGame || serverGame.status !== 'completed' || recordedRef.current) return;
        if (!mySeat || !user) return; // only participants record
        recordedRef.current = true;
        recordCompletedGame(serverGame, user.uid).catch(() => {});
    }, [serverGame, mySeat, user]);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const pendingCount = useMemo(() => pendingRef.current.length, [pendingVersion]);

    return { game, loading, error, mySeat, isHost, act, actionError, synced, pendingCount };
};
