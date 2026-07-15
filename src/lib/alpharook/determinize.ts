// World sampling: turn an Observation into complete, rules-consistent guesses
// about the hidden cards. This is how AlphaRook "imagines" what it can't see
// — every sampled world places the unseen cards so that hand sizes match,
// nobody holds a suit they've already shown void in, and (for non-declarers)
// four unknown cards sit in the go-down.
//
// v0 samples uniformly over consistent worlds. gen16 adds
// sampleWorldWeighted: the same constraints, but each card lands where a
// learned posterior says it lives ("she bid 100, she has trump") — the
// belief head biasing the SAMPLER, not re-weighting worlds after the fact.
// Port of ml/rook/determinize.py sample_world_weighted.

import { Card, Seat, SEATS } from '../game/types';
import { cardToInt } from './encoder';
import { Observation, unseenCards, knownVoids, handSizes } from './observation';

export interface World {
    /** full hands for all four seats, consistent with the observation */
    hands: Record<Seat, Card[]>;
    /** the four go-down cards (the observer's own if they took the bid) */
    goDown: Card[];
}

const shuffle = <T>(arr: T[], rand: () => number = Math.random): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};

interface Slot {
    /** a seat, or null for the hidden go-down (which accepts anything) */
    seat: Seat | null;
    left: number;
    banned: Set<string>; // suits this slot cannot take
}

/**
 * Exact fallback: backtracking assignment of the pool into slots. Since the
 * real deal is always one consistent world, this cannot fail on a correct
 * observation. Cards with the fewest eligible slots go first, and slot order
 * is shuffled per card so repeated calls still sample varied worlds.
 */
const solveWorld = (pool: Card[], slots: Slot[], rand: () => number = Math.random): Map<Card, Slot> | null => {
    const eligible = (c: Card) => slots.filter((s) => !s.banned.has(c.suit)).length;
    const cards = [...pool].sort((a, b) => eligible(a) - eligible(b));
    const assignment = new Map<Card, Slot>();

    const solve = (idx: number): boolean => {
        if (idx === cards.length) return true;
        const card = cards[idx];
        for (const slot of shuffle(slots, rand)) {
            if (slot.left === 0 || slot.banned.has(card.suit)) continue;
            slot.left--;
            assignment.set(card, slot);
            if (solve(idx + 1)) return true;
            slot.left++;
            assignment.delete(card);
        }
        return false;
    };
    return solve(0) ? assignment : null;
};

/**
 * Sample one complete world consistent with what the observer knows.
 * Fast path: rejection sampling against the void constraints (rarely tight).
 * When the endgame squeezes those constraints hard enough that greedy tries
 * keep colliding, fall back to the exact backtracking solver.
 */
export const sampleWorld = (o: Observation, rand: () => number = Math.random): World => {
    const pool = unseenCards(o);
    const sizes = handSizes(o);
    const voids = knownVoids(o);
    const others = SEATS.filter((s) => s !== o.seat);

    const need: [Seat, number][] = others.map((s) => [s, sizes[s]]);
    const goDownNeeded = o.myGoDown ? 0 : 4;

    for (let attempt = 0; attempt < 20; attempt++) {
        const deck = shuffle(pool, rand);
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

    // greedy kept colliding — solve it exactly
    const slots: Slot[] = need.map(([seat, size]) => ({
        seat, left: size, banned: new Set<string>(Array.from(voids[seat])),
    }));
    slots.push({ seat: null, left: goDownNeeded, banned: new Set() });
    const solved = solveWorld(pool, slots, rand);
    if (!solved) throw new Error('sampleWorld: observation is internally inconsistent');

    const hands: Record<Seat, Card[]> = {
        A1: [], B1: [], A2: [], B2: [], [o.seat]: [...o.hand],
    };
    const goDown: Card[] = o.myGoDown ? [...o.myGoDown] : [];
    solved.forEach((slot, card) => {
        if (slot.seat) hands[slot.seat].push(card);
        else goDown.push(card);
    });
    return { hands, goDown };
};

/**
 * One consistent world drawn from a learned posterior (gen16).
 *
 * `probs[cardInt][cls]` is P(who holds the card) in the belief head's
 * convention: cls 0/1/2 = the seats one/two/three after me in play order,
 * cls 3 = the hidden go-down. Rows for cards the observer can see are
 * ignored. Cards are placed one at a time in random order, each landing in
 * an eligible slot (capacity left, no known void) with probability
 * proportional to the posterior — voids and hand sizes still bind exactly,
 * and only genuinely ambiguous placements follow the net's imagination.
 * If the greedy fill corners itself repeatedly it falls back to the
 * uniform sampler, which cannot fail.
 */
export const sampleWorldWeighted = (
    o: Observation,
    probs: number[][],
    rand: () => number = Math.random,
): World => {
    const pool = unseenCards(o);
    const sizes = handSizes(o);
    const voids = knownVoids(o);
    const others = SEATS.filter((s) => s !== o.seat);
    const meIdx = SEATS.indexOf(o.seat);
    const relCls = new Map<Seat, number>(
        others.map((s) => [s, (SEATS.indexOf(s) - meIdx + 4) % 4 - 1]),
    );
    const goDownNeeded = o.myGoDown ? 0 : 4;

    for (let attempt = 0; attempt < 30; attempt++) {
        const caps = new Map<Seat, number>(others.map((s) => [s, sizes[s]]));
        let gdLeft = goDownNeeded;
        const placed = new Map<Seat, Card[]>(others.map((s) => [s, []]));
        const goDownPick: Card[] = [];
        const order = shuffle(pool, rand);
        let ok = true;
        for (const c of order) {
            const row = probs[cardToInt(c)];
            const opts: (Seat | null)[] = [];
            const wts: number[] = [];
            for (const s of others) {
                if (caps.get(s)! > 0 && !voids[s].has(c.suit)) {
                    opts.push(s);
                    wts.push(Math.max(row[relCls.get(s)!], 1e-6));
                }
            }
            if (gdLeft > 0) {
                opts.push(null);
                wts.push(Math.max(row[3], 1e-6));
            }
            if (opts.length === 0) { ok = false; break; }
            let r = rand() * wts.reduce((a, b) => a + b, 0);
            let pick = opts[opts.length - 1];
            for (let i = 0; i < opts.length; i++) {
                r -= wts[i];
                if (r < 0) { pick = opts[i]; break; }
            }
            if (pick === null) {
                gdLeft--;
                goDownPick.push(c);
            } else {
                caps.set(pick, caps.get(pick)! - 1);
                placed.get(pick)!.push(c);
            }
        }
        if (!ok) continue;
        const hands: Record<Seat, Card[]> = {
            A1: [], B1: [], A2: [], B2: [], [o.seat]: [...o.hand],
        };
        for (const s of others) hands[s] = placed.get(s)!;
        const goDown = o.myGoDown ? [...o.myGoDown] : goDownPick;
        return { hands, goDown };
    }

    return sampleWorld(o, rand);
};
