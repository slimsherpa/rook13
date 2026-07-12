'use client';

// The "hold" behind manual table pace: a tiny page-wide latch that pauses
// the table's theater (trick sweep, recap pop, THIS device's bot moves)
// while the player counts the cards on the felt.
//
// Armed by TableView when a trick completes in manual mode; released by the
// floating advance button — or automatically by any new play, from anyone,
// so a multiplayer table can never gridlock on one person's setting. One
// latch per page is exactly right: there's one table on screen.

import { useSyncExternalStore } from 'react';

let armed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const armTableHold = (): void => {
    if (!armed) {
        armed = true;
        emit();
    }
};

export const releaseTableHold = (): void => {
    if (armed) {
        armed = false;
        emit();
    }
};

export const isTableHeld = (): boolean => armed;

export const subscribeTableHold = (onChange: () => void): (() => void) => {
    listeners.add(onChange);
    return () => {
        listeners.delete(onChange);
    };
};

export const useTableHold = (): boolean =>
    useSyncExternalStore(subscribeTableHold, isTableHeld, () => false);
