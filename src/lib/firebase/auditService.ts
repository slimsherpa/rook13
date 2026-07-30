// Hindsight blunder audits, one doc per finished hand at
// games/{id}/audits/{handNumber} — written ONLY by the Cloud Run service
// (AlphaGodRook's exact solver replays the hand in the true world; rules
// deny client writes). Clients ask the service to run one, then hear the
// verdict through the normal Firestore subscription.

import { collection, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import { Card, Seat } from '../game/types';
import { BOT_SERVICE_URL } from '../botService';

export interface AuditBlunder {
    /** trick index within the hand, 0-based */
    trick: number;
    seat: Seat;
    card: Card;
    better: Card;
    /** points the play cost its team vs the best card, in the true world */
    delta: number;
}

export interface HandAudit {
    hand: number;
    blunders: AuditBlunder[];
    analyzed: number;
    skipped: number;
}

const requested = new Set<string>(); // gameId:hand this tab already asked for

/** Fire-and-forget: ask the service to solve a finished hand (idempotent
 *  server-side — one solve per hand no matter how many phones ask). */
export const requestHandAudit = (gameId: string, hand: number): void => {
    const key = `${gameId}:${hand}`;
    if (requested.has(key)) return;
    requested.add(key);
    fetch(`${BOT_SERVICE_URL}/audit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId, hand }),
        keepalive: true,
    }).catch(() => requested.delete(key)); // retry allowed if it never landed
};

export const subscribeAudits = (
    gameId: string,
    onChange: (audits: Map<number, HandAudit>) => void,
): Unsubscribe =>
    onSnapshot(collection(db, 'games', gameId, 'audits'), (snap) => {
        const m = new Map<number, HandAudit>();
        for (const d of snap.docs) {
            const a = d.data() as HandAudit;
            if (typeof a.hand === 'number') m.set(a.hand, a);
        }
        onChange(m);
    });
