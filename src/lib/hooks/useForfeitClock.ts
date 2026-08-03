'use client';

// The competitive-lobby turn clock: a HUMAN who sits on their turn for a
// full minute forfeits the game for their team (bots play themselves, so
// they never time out; server bots have their own 20s cover).
//
// OFF unless the host arms it (game.clockEnabled, SET_CLOCK): by default
// everyone takes all the time they want. Armed, it's the Disneyland rule —
// the last cousin still able to play before the ride wins.
//
// Every open client runs the clock off the same facts — game.updatedAt
// (stamped by the last applied action) and game.turn — so all devices
// count down in lockstep, and whoever's timer fires first wins the
// FORFEIT submission; submitAction's optimistic-concurrency check makes
// the extras harmless races, exactly like duplicate bot moves.

import { useEffect, useRef, useState } from 'react';
import { GameDoc, Seat, SEATS } from '../game/types';
import { submitAction, isExpectedRaceError } from '../firebase/gameService';

export const FORFEIT_MS = 60_000;       // the full clock
export const CLOCK_SHOW_S = 30;         // chip appears with this many seconds left
export const CLOCK_PANIC_S = 15;        // the on-clock player gets the big warning

/** Phases where a human can actually be "on the clock". */
const CLOCKED_PHASES = new Set(['bidding', 'widow', 'trump', 'playing']);

export interface ForfeitClock {
    /** seat currently on the clock, or null when nobody is */
    seat: Seat | null;
    /** whole seconds left before the forfeit fires */
    remaining: number;
}

export const useForfeitClock = (game: GameDoc | null, gameId: string | null): ForfeitClock => {
    const [nowMs, setNowMs] = useState(() => Date.now());
    const firedFor = useRef(-1); // actionCount we already submitted a forfeit against

    // The clock is a courtesy to OTHER HUMANS waiting on you — solo-vs-bots
    // games never time out (take the phone call, finish the sandwich).
    const humansSeated = game
        ? SEATS.filter((s) => game.seats[s].kind === 'human').length
        : 0;
    const armed = !!(
        game && gameId
        && game.clockEnabled === true
        && game.status === 'active'
        && humansSeated >= 2
        && game.turn
        && CLOCKED_PHASES.has(game.phase)
        && game.seats[game.turn].kind === 'human'
    );

    // Tick only while a human is on the clock — and coarsely (5s) until the
    // countdown window opens, so the table isn't re-rendered every second
    // for the first half-minute of every human turn.
    useEffect(() => {
        if (!armed || !game) return;
        const deadlineMs = game.updatedAt + FORFEIT_MS;
        let t: ReturnType<typeof setTimeout> | null = null;
        const tick = () => {
            const now = Date.now();
            setNowMs(now);
            const untilShow = deadlineMs - now - CLOCK_SHOW_S * 1000;
            t = setTimeout(tick, untilShow > 6000 ? 5000 : 1000);
        };
        tick();
        return () => { if (t) clearTimeout(t); };
    }, [armed, game?.actionCount]);

    const deadline = armed && game ? game.updatedAt + FORFEIT_MS : Infinity;
    const remaining = Math.max(0, Math.ceil((deadline - nowMs) / 1000));

    // the deadline passed on this device first (or simultaneously —
    // the transaction sorts it out)
    useEffect(() => {
        if (!armed || !game || !gameId || remaining > 0) return;
        if (firedFor.current === game.actionCount) return;
        firedFor.current = game.actionCount;
        submitAction(gameId, { type: 'FORFEIT', seat: game.turn! }, 'clock', game.actionCount)
            .catch((e) => {
                if (!isExpectedRaceError(e)) console.error('forfeit submit failed', e);
            });
    }, [armed, remaining, game, gameId]);

    if (!armed || !game) return { seat: null, remaining: FORFEIT_MS / 1000 };
    return { seat: game.turn, remaining };
};
