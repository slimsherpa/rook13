// World sampling: turn an Observation into complete, rules-consistent guesses
// about the hidden cards. This is how AlphaRook "imagines" what it can't see
// — every sampled world places the unseen cards so that hand sizes match,
// nobody holds a suit they've already shown void in, and (for non-declarers)
// four unknown cards sit in the go-down.
//
// v0 samples uniformly over consistent worlds. Later generations can bias
// the sampling with learned inference (e.g. "she bid 100, she has trump").

import { Card, Seat, SEATS } from '../game/types';
import { Observation, unseenCards, knownVoids, handSizes } from './observation';

export interface World {
    /** full hands for all four seats, consistent with the observation */
    hands: Record<Seat, Card[]>;
    /** the four go-down cards (the observer's own if they took the bid) */
    goDown: Card[];
}

const shuffle = <T>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};

/**
 * Sample one complete world consistent with what the observer knows.
 * Rejection-samples against the void constraints (they're rarely tight, so a
 * handful of tries almost always lands; the deterministic fallback fills
 * constrained seats first).
 */
export const sampleWorld = (o: Observation): World => {
    const pool = unseenCards(o);
    const sizes = handSizes(o);
    const voids = knownVoids(o);
    const others = SEATS.filter((s) => s !== o.seat);

    const need: [Seat, number][] = others.map((s) => [s, sizes[s]]);
    const goDownNeeded = o.myGoDown ? 0 : 4;

    for (let attempt = 0; attempt < 50; attempt++) {
        const deck = shuffle(pool);
        const hands: Partial<Record<Seat, Card[]>> = { [o.seat]: [...o.hand] };
        const goDown: Card[] = o.myGoDown ? [...o.myGoDown] : [];
        let ok = true;

        // fill the most constrained seats first (most known voids)
        const order = [...need].sort(
            (a, b) => voids[b[0]].size - voids[a[0]].size,
        );
        const remaining = [...deck];
        for (const [seat, size] of order) {
            const legal = remaining.filter((c) => !voids[seat].has(c.suit));
            if (legal.length < size) { ok = false; break; }
            const take = legal.slice(0, size);
            hands[seat] = take;
            for (const c of take) remaining.splice(remaining.indexOf(c), 1);
        }
        if (!ok) continue;
        // whatever's left is the hidden go-down
        if (remaining.length !== goDownNeeded) continue;
        goDown.push(...remaining);
        return { hands: hands as Record<Seat, Card[]>, goDown };
    }
    throw new Error('sampleWorld: no consistent world found (constraint bug?)');
};
