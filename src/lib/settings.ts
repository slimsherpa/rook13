'use client';

// Per-device game pacing. The bots' *brains* are untouched — this scales the
// theatrical waits: bot "thinking" pauses, trick lingers, capture sweeps,
// recap delays. Stored in localStorage so it follows the device (a tester's
// laptop can run Blazing while the family iPad stays Normal), and broadcast
// through a window event so every component re-renders the moment it changes.

import { useCallback, useSyncExternalStore } from 'react';

export type GameSpeed = 'relaxed' | 'normal' | 'fast' | 'blazing';

export const GAME_SPEEDS: { id: GameSpeed; label: string; blurb: string; icon: string; multiplier: number }[] = [
    { id: 'relaxed', label: 'Relaxed', blurb: 'Porch-swing pace, long lingers', icon: 'self_improvement', multiplier: 1.5 },
    { id: 'normal',  label: 'Normal',  blurb: 'The family-table default',      icon: 'group',            multiplier: 1 },
    { id: 'fast',    label: 'Fast',    blurb: 'Snappy moves, short waits',     icon: 'speed',            multiplier: 0.4 },
    { id: 'blazing', label: 'Blazing', blurb: 'Near-instant — AI testing',     icon: 'bolt',             multiplier: 0.1 },
];

const KEY = 'rook13-game-speed';
const EVT = 'rook13-speed-change';

const isSpeed = (v: unknown): v is GameSpeed =>
    GAME_SPEEDS.some((s) => s.id === v);

export const getGameSpeed = (): GameSpeed => {
    if (typeof window === 'undefined') return 'normal';
    const v = window.localStorage.getItem(KEY);
    return isSpeed(v) ? v : 'normal';
};

export const setGameSpeed = (speed: GameSpeed): void => {
    window.localStorage.setItem(KEY, speed);
    window.dispatchEvent(new Event(EVT));
};

export const speedMultiplier = (): number =>
    GAME_SPEEDS.find((s) => s.id === getGameSpeed())!.multiplier;

/** Scale a wait/animation duration by the device's game speed. */
export const paced = (ms: number): number => Math.round(ms * speedMultiplier());

const subscribe = (onChange: () => void) => {
    window.addEventListener(EVT, onChange);
    window.addEventListener('storage', onChange); // other tabs
    return () => {
        window.removeEventListener(EVT, onChange);
        window.removeEventListener('storage', onChange);
    };
};

export const useGameSpeed = (): [GameSpeed, (s: GameSpeed) => void] => {
    const speed = useSyncExternalStore(subscribe, getGameSpeed, () => 'normal' as GameSpeed);
    const set = useCallback((s: GameSpeed) => setGameSpeed(s), []);
    return [speed, set];
};
