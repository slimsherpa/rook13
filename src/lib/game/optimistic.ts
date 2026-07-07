// Optimistic-action overlay.
//
// The engine is pure and deterministic (randomness travels inside action
// payloads), so a client can apply its own action locally the instant the
// player taps — the card hits the table with zero latency — while the
// Firestore transaction confirms in the background. This module is the
// bookkeeping for that: replay the not-yet-confirmed actions on top of the
// latest server state, and quietly retire any the server has since applied
// (replaying those throws — the card is already gone) or rejected.

import { GameDoc, GameAction } from './types';
import { applyAction } from './engine';

export interface PendingAction {
    /** local sequence number, unique per hook instance */
    id: number;
    action: GameAction;
    /** server actionCount after this action, once the transaction commits */
    confirmedCount?: number;
}

export interface OverlayResult {
    /** server state with the surviving pending actions applied on top */
    game: GameDoc;
    /** pending actions not yet reflected in `server` — the rest can be dropped */
    survivors: PendingAction[];
}

export const overlayPending = (server: GameDoc, pending: PendingAction[]): OverlayResult => {
    let game = server;
    const survivors: PendingAction[] = [];
    for (const p of pending) {
        // the transaction committed and this snapshot already includes it
        if (p.confirmedCount !== undefined && server.actionCount >= p.confirmedCount) continue;
        try {
            game = applyAction(game, p.action);
            survivors.push(p);
        } catch {
            // no longer legal on the newer state — the server already applied
            // it (or something superseded it), so the overlay is done with it
        }
    }
    return { game, survivors };
};

/** Structural equality for actions, used to swallow double-taps. */
export const sameAction = (a: GameAction, b: GameAction): boolean =>
    JSON.stringify(a) === JSON.stringify(b);
