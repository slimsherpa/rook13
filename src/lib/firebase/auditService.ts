// Hindsight blunder audits, one doc per finished hand at
// games/{id}/audits/{handNumber} — written ONLY by the Cloud Run service
// (AlphaGodRook's exact solver replays the hand in the true world; rules
// deny client writes). Clients ask the service to run one, then hear the
// verdict through the normal Firestore subscription.

import { collection, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import { Card, Seat } from '../game/types';
import { BOT_SERVICE_URL, botServiceHeaders } from '../botService';

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
    /** total points each seat leaked across the hand (small slips add up) */
    leaks?: Record<string, number>;
    /** what the declaring team takes at PERFECT play by everyone, or null
     *  when even the solver couldn't crack the opening in time */
    par?: number | null;
    /** 0 = par is exact from the opening lead; k>0 = par measured from trick k+1 */
    parFrom?: number | null;
    bid?: number | null;
    bidWinner?: Seat | null;
    analyzed: number;
    skipped: number;
}

const requested = new Set<string>(); // gameId:hand this tab already asked for

/** Ask the service to solve a finished hand (idempotent server-side — one
 *  solve per hand no matter how many phones ask). Resolves false when the
 *  request failed, so the caller can put the button back instead of
 *  pulsing forever. */
export const requestHandAudit = async (gameId: string, hand: number): Promise<boolean> => {
    const key = `${gameId}:${hand}`;
    if (requested.has(key)) return true;
    requested.add(key);
    try {
        const res = await fetch(`${BOT_SERVICE_URL}/audit`, {
            method: 'POST',
            headers: await botServiceHeaders(),
            body: JSON.stringify({ gameId, hand }),
        });
        if (!res.ok) throw new Error(String(res.status));
        return true;
    } catch (e) {
        console.warn(`audit request for hand ${hand} failed`, e);
        requested.delete(key); // allow a retry
        return false;
    }
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
