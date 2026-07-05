// Post-game review: rebuild every hand of a finished game — every trick,
// every bid, the go-down — by replaying the append-only action log through
// the deterministic engine. The live GameDoc only keeps the current hand's
// tricks, so this is how the family gets to argue about hand 3 afterwards.

import { GameDoc, GameAction, Card, Suit, TrickRecord, HandSummary } from './types';
import { createGameDoc, applyAction } from './engine';

export interface HandReview {
    summary: HandSummary;
    tricks: TrickRecord[];
    goDown: Card[];
    trump: Suit;
    /** bids in the order they happened this hand */
    bids: { seat: string; bid: number | 'pass' }[];
}

export interface GameReviewData {
    hands: HandReview[];
    /** false when the log couldn't be fully replayed (partial results shown) */
    complete: boolean;
}

/**
 * Replay the action log and snapshot each hand as it finishes.
 * `finalGame` supplies identity fields (id, joinCode, host) that predate the log.
 */
export const reconstructGame = (
    finalGame: GameDoc,
    actions: GameAction[],
): GameReviewData => {
    const hostName =
        Object.values(finalGame.seats).find(
            (s) => s.kind === 'human' && s.uid === finalGame.hostUid,
        )?.name ?? 'Host';

    // Mirrors createGame(): the host starts seated at A1.
    let state = createGameDoc({
        id: finalGame.id,
        joinCode: finalGame.joinCode,
        host: { uid: finalGame.hostUid, name: hostName },
        now: finalGame.createdAt,
    });

    const hands: HandReview[] = [];
    let bids: { seat: string; bid: number | 'pass' }[] = [];

    for (const action of actions) {
        if (action.type === 'BID') bids.push({ seat: action.seat, bid: action.bid });
        let next: GameDoc;
        try {
            next = applyAction(state, action);
        } catch {
            // A divergent log (legacy game, hand-edited doc) — keep what we have.
            return { hands, complete: false };
        }
        const handJustEnded =
            next.handHistory.length > state.handHistory.length;
        if (handJustEnded) {
            hands.push({
                summary: next.handHistory[next.handHistory.length - 1],
                tricks: next.completedTricks,
                goDown: next.goDown,
                trump: next.trump!,
                bids,
            });
            bids = [];
        }
        state = next;
    }
    return { hands, complete: true };
};
