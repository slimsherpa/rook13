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
import { GameDoc, GameAction, Seat, SEATS, isServerStyle, isServerDriven } from '../game/types';
import { validateAction } from '../game/engine';
import { nextAgentActionAsync, preloadNets } from '../alpharook/agent';
import { overlayPending, sameAction, PendingAction } from '../game/optimistic';
import { subscribeGame, submitAction, isExpectedRaceError, describeFirestoreError } from '../firebase/gameService';
import { nudgeBotService, botServiceHealthy } from '../botService';
import { recordGameStats } from '../firebase/userService';
import { paced } from '../settings';
import { useTableHold } from '../tableHold';
import { useAuth } from './useAuth';

// Base pacing; every delay runs through paced() so the device's game-speed
// setting scales the theater without touching what the bots play.
const BOT_BASE_DELAY_MS = 1100;      // natural pacing for bot moves
const BOT_DEAL_DELAY_MS = 1400;
const BOT_REDEAL_PAUSE_MS = 6500;    // let the redeal celebration breathe
// leading the next trick waits out the linger + capture sweep of the last one
const BOT_TRICK_LEAD_DELAY_MS = 3200;
const FALLBACK_EXTRA_MS = 2500;      // non-host clients wait longer before covering
// SERVER_STYLES seats think in the Cloud Run bot service; the client only
// covers (with the strongest local brain) if the service stays silent this
// long. Deliberately unpaced — it's a failsafe, not theater.
const SERVER_COVER_MS = 20000;
// AlphaGodRook's exact solver gets a bigger budget (GOD_BUDGET_S=25s on the
// service) and announces slow thinks in table chat at 8s — and the table
// offers "just play your best guess" at the same mark — so his seats get
// a roomier grace before the local cover moves for him. Only applies while
// the service looks healthy — a known-down service still covers at normal
// bot pacing.
const GODROOK_COVER_MS = 40000;

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
    /** a Cloud Run bot seat we're currently waiting on, and since when —
     *  lets the table offer "just play your best guess" on a long think */
    serverThinking: { seat: Seat; since: number } | null;
    /** skip the rest of the server grace and play the local cover move now */
    hurryUp: () => void;
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
    // manual table pace: while this device holds the table, its bots wait too
    const tableHeld = useTableHold();
    const [serverThinking, setServerThinking] = useState<{ seat: Seat; since: number } | null>(null);
    // the armed cover move, exposed so hurryUp() can fire it early
    const coverRef = useRef<{ expected: number; fire: (viaHurry: boolean) => void } | null>(null);
    // last snapshot, for naming the CLOUD brain when its move lands — the
    // eager "🧠 gen19 …" lines are only the local backup being warmed
    const prevSnapRef = useRef<GameDoc | null>(null);
    useEffect(() => {
        if (botTimer.current) {
            clearTimeout(botTimer.current);
            botTimer.current = null;
        }
        coverRef.current = null;
        setServerThinking(null);
        if (!serverGame || !gameId || !user || serverGame.status !== 'active') return;

        // name the cloud brain when its move arrives: if the previous
        // snapshot was a server bot's turn and the log advanced, the move
        // that landed was the CLOUD's (a local cover logs itself loudly)
        const prevSnap = prevSnapRef.current;
        prevSnapRef.current = serverGame;
        if (prevSnap && prevSnap.turn && serverGame.actionCount > prevSnap.actionCount) {
            const info = prevSnap.seats[prevSnap.turn];
            if (info?.kind === 'bot' && isServerDriven(prevSnap, info.botStyle)) {
                let what = 'moved';
                const np = serverGame.trickPlays;
                const done = serverGame.completedTricks;
                const played = np.length > prevSnap.trickPlays.length
                    ? np[np.length - 1]
                    : (done.length > prevSnap.completedTricks.length
                        ? done[done.length - 1].plays[done[done.length - 1].plays.length - 1]
                        : null);
                if (played && played.seat === prevSnap.turn) {
                    what = `plays ${played.card.suit} ${played.card.number}`;
                }
                console.info(`☁️ ${info.botStyle} ${prevSnap.turn} ${what} (cloud brain — the 🧠 gen19 lines are the standby backup)`);
            }
        }

        if (!mySeat && !isHost) return; // spectators never drive bots
        if (tableHeld) return; // the player is counting — resume on release

        // warm the neural-bot weight cache so the first bid doesn't wait on it
        preloadNets(serverGame);

        // SERVER_STYLES thinking decisions belong to the Cloud Run driver;
        // the client's only job is the failsafe cover below (their DEAL /
        // ACK_REDEAL shuffles still run through the normal path — the server
        // never deals). The substitute brain is gen19, the strongest local
        // stack; submitAction's optimistic-concurrency check keeps a slow
        // server answer and a cover from both landing.
        const turnInfo = serverGame.turn ? serverGame.seats[serverGame.turn] : null;
        const serverDriven = !!(turnInfo && turnInfo.kind === 'bot'
            && isServerDriven(serverGame, turnInfo.botStyle)
            && ['bidding', 'widow', 'trump', 'playing'].includes(serverGame.phase));
        // local standby brain while the cloud thinks: a DayDreaming Gen26
        // seat covers with its OWN reflex (same organ, instant tier);
        // permanent server styles cover with gen19, the strongest local stack
        const coverGame: GameDoc = serverDriven
            ? {
                ...serverGame,
                seats: {
                    ...serverGame.seats,
                    [serverGame.turn!]: {
                        ...turnInfo!,
                        botStyle: turnInfo!.botStyle === 'gen26' ? ('gen26' as const) : ('gen19' as const),
                    },
                },
            }
            : serverGame;
        if (serverDriven) {
            nudgeBotService(gameId, serverGame.actionCount);
            setServerThinking({ seat: serverGame.turn!, since: Date.now() });
        }

        // Computing the move may await weight loading (neural bots), so the
        // pacing timer is armed once the action is known; a newer snapshot
        // cancels both the wait and the timer.
        let cancelled = false;
        const actionPromise = nextAgentActionAsync(coverGame);

        // Arm the "best guess" button BEFORE the compute resolves: fire
        // awaits the same promise, so there is NO window where the hurry
        // banner shows but a click silently no-ops (Riley's report,
        // 2026-08-14 — the old arming happened after the await).
        const expected = serverGame.actionCount;
        const fireCover = async (viaHurry: boolean) => {
            const action = await actionPromise;
            if (!action) {
                if (viaHurry) console.warn('⏩ best guess: no local cover action — nothing to play');
                return;
            }
            try {
                if (serverDriven && !viaHurry) console.warn(`⚠️ bot service unreachable — local cover for ${serverGame.turn}`);
                if (viaHurry) console.info(`⏩ best guess: local ${coverGame.seats[serverGame.turn!].botStyle} reflex plays for ${serverGame.turn}`);
                // 'bot-cover' marks browser-backup moves for cloud seats in
                // the audit log; the table shows a 💻 toast when one lands
                await submitAction(gameId, action, serverDriven ? 'bot-cover' : 'bot', expected);
                if (serverDriven && typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('rook13-bot-cover', { detail: { seat: serverGame.turn, viaHurry } }));
                }
            } catch (e) {
                if (!isExpectedRaceError(e)) console.error('bot move failed', e);
                else if (viaHurry) console.info('⏩ best guess: the cloud answered first — its move stands');
            }
        };
        if (serverDriven) coverRef.current = { expected, fire: fireCover };

        (async () => {
            const action = await actionPromise;
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
            // a known-down service gets normal bot pacing, not the long grace
            const delay = serverDriven && botServiceHealthy()
                // anytime-searcher styles (gardner, DayDreaming gen26) —
                // opening leads can breach the 20s grace, so they get
                // godrook's roomier clock
                ? (turnInfo!.botStyle === 'godrook' || turnInfo!.botStyle === 'gardner'
                    || (turnInfo!.botStyle === 'gen26' && serverGame.botThink)
                    ? GODROOK_COVER_MS : SERVER_COVER_MS)
                    + (isHost ? 0 : FALLBACK_EXTRA_MS)
                : paced(baseDelay + jitter) + (isHost ? 0 : paced(FALLBACK_EXTRA_MS));
            if (cancelled) return;
            botTimer.current = setTimeout(() => fireCover(false), delay);
        })();

        return () => {
            cancelled = true;
            if (botTimer.current) clearTimeout(botTimer.current);
            coverRef.current = null;
        };
    }, [serverGame, gameId, user, mySeat, isHost, tableHeld]);

    // "just make your best guess": the player got tired of waiting — fire the
    // local cover now instead of at the end of the grace window. Safe against
    // a simultaneous server answer: both go through the same
    // optimistic-concurrency check, only one lands.
    const hurryUp = useCallback(() => {
        const cover = coverRef.current;
        if (!cover) return;
        coverRef.current = null;
        if (botTimer.current) {
            clearTimeout(botTimer.current);
            botTimer.current = null;
        }
        cover.fire(true);
    }, []);

    // ---- stats recording (confirmed state only) ----
    // Runs at every hand end AND at completion; recordGameStats is idempotent
    // (the history doc tracks how many hands are already counted), so the
    // Trophy Case fills up live while the game is still going.
    const recordedKeyRef = useRef('');
    useEffect(() => {
        if (!serverGame || !mySeat || !user) return; // only participants record
        if (serverGame.handHistory.length === 0) return;
        const key = `${serverGame.handHistory.length}:${serverGame.status}`;
        if (recordedKeyRef.current === key) return;
        recordedKeyRef.current = key;
        recordGameStats(serverGame, user.uid).catch(() => {});
    }, [serverGame, mySeat, user]);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const pendingCount = useMemo(() => pendingRef.current.length, [pendingVersion]);

    return { game, loading, error, mySeat, isHost, act, actionError, synced, pendingCount, serverThinking, hurryUp };
};
