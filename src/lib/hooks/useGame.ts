'use client';

// Live game subscription + the bot runner.
//
// Every connected human client watches the game; when it's a bot's turn each
// client schedules the bot's move with a small stagger (host first, everyone
// else as fallback). submitAction's optimistic-concurrency check guarantees
// exactly one submission wins, so a host closing their phone never stalls
// the bots for long.

import { useCallback, useEffect, useRef, useState } from 'react';
import { GameDoc, GameAction, Seat, SEATS } from '../game/types';
import { nextBotAction } from '../game/bots';
import { subscribeGame, submitAction, isExpectedRaceError, describeFirestoreError } from '../firebase/gameService';
import { recordCompletedGame } from '../firebase/userService';
import { useAuth } from './useAuth';

const BOT_BASE_DELAY_MS = 1100;      // natural pacing for bot moves
const BOT_DEAL_DELAY_MS = 1400;
const BOT_REDEAL_PAUSE_MS = 6500;    // let the redeal celebration breathe
const FALLBACK_EXTRA_MS = 2500;      // non-host clients wait longer before covering

export interface UseGameResult {
    game: GameDoc | null;
    loading: boolean;
    error: string | null;
    /** seat of the signed-in user, or null (spectator) */
    mySeat: Seat | null;
    isHost: boolean;
    act: (action: GameAction) => Promise<void>;
    /** last action error (e.g. "You must follow suit"), cleared on success */
    actionError: string | null;
}

export const useGame = (gameId: string | null): UseGameResult => {
    const { user } = useAuth();
    const [game, setGame] = useState<GameDoc | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const botTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!gameId) {
            setLoading(false);
            return;
        }
        setLoading(true);
        const unsub = subscribeGame(
            gameId,
            (g) => {
                setGame(g);
                setLoading(false);
                setError(g ? null : 'Game not found');
            },
            (e) => {
                setLoading(false);
                setError(describeFirestoreError(e));
            },
        );
        return unsub;
    }, [gameId]);

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
        try {
            await submitAction(gameId, action, user.uid);
            setActionError(null);
        } catch (e: any) {
            if (!isExpectedRaceError(e)) {
                setActionError(describeFirestoreError(e));
            }
        }
    }, [gameId, user]);

    // ---- bot runner ----
    useEffect(() => {
        if (botTimer.current) {
            clearTimeout(botTimer.current);
            botTimer.current = null;
        }
        if (!game || !gameId || !user || game.status !== 'active') return;
        if (!mySeat && !isHost) return; // spectators never drive bots

        const action = nextBotAction(game);
        if (!action) return;

        const baseDelay =
            action.type === 'ACK_REDEAL' ? BOT_REDEAL_PAUSE_MS :
            action.type === 'DEAL' ? BOT_DEAL_DELAY_MS :
            BOT_BASE_DELAY_MS;
        const jitter = Math.random() * 400;
        const delay = baseDelay + jitter + (isHost ? 0 : FALLBACK_EXTRA_MS);
        const expected = game.actionCount;

        botTimer.current = setTimeout(async () => {
            try {
                await submitAction(gameId, action, 'bot', expected);
            } catch (e) {
                if (!isExpectedRaceError(e)) console.error('bot move failed', e);
            }
        }, delay);

        return () => {
            if (botTimer.current) clearTimeout(botTimer.current);
        };
    }, [game, gameId, user, mySeat, isHost]);

    // ---- stats recording on completion ----
    const recordedRef = useRef(false);
    useEffect(() => {
        if (!game || game.status !== 'completed' || recordedRef.current) return;
        if (!mySeat || !user) return; // only participants record
        recordedRef.current = true;
        recordCompletedGame(game, user.uid).catch(() => {});
    }, [game, mySeat, user]);

    return { game, loading, error, mySeat, isHost, act, actionError };
};
