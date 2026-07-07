// AlphaRook's window into the game. This is the ONLY thing an agent may see.
//
// The rule-integrity contract: an Observation for a seat contains exactly the
// information a human in that chair would have — their own cards, everything
// played face-up, the bidding, and (only if they took the bid) the widow/
// go-down they themselves handled. Never other players' hands, never a widow
// they didn't win. Agents receive an Observation, not a GameDoc, so cheating
// is impossible by construction; observation.test.ts additionally proves no
// hidden card can leak through.

import { GameDoc, Card, Seat, Suit, Team, TrickRecord, Phase, SUITS } from '../game/types';

export interface Observation {
    seat: Seat;
    phase: Phase;
    turn: Seat | null;
    handNumber: number;
    dealer: Seat | null;

    // auction (fully public)
    bids: Partial<Record<Seat, number | 'pass'>>;
    highBid: number | null;
    bidWinner: Seat | null;
    trump: Suit | null;

    // my private cards
    hand: Card[];
    /** the go-down I chose — null unless I am the bid winner */
    myGoDown: Card[] | null;

    // table state (fully public)
    trickLeader: Seat | null;
    trickPlays: { seat: Seat; card: Card }[];
    completedTricks: TrickRecord[];
    tricksWon: Record<Team, number>;
    pointsTaken: Record<Team, number>;
    scores: Record<Team, number>;
}

/** Build what `seat` can legally see. Pure; never exposes hidden zones. */
export const observe = (g: GameDoc, seat: Seat): Observation => ({
    seat,
    phase: g.phase,
    turn: g.turn,
    handNumber: g.handNumber,
    dealer: g.dealer,
    bids: { ...g.bids },
    highBid: g.highBid,
    bidWinner: g.bidWinner,
    trump: g.trump,
    hand: g.hands[seat].map((c) => ({ ...c })),
    myGoDown: g.bidWinner === seat ? g.goDown.map((c) => ({ ...c })) : null,
    trickLeader: g.trickLeader,
    trickPlays: g.trickPlays.map((p) => ({ seat: p.seat, card: { ...p.card } })),
    completedTricks: g.completedTricks.map((t) => ({
        leader: t.leader,
        plays: t.plays.map((p) => ({ seat: p.seat, card: { ...p.card } })),
        winner: t.winner,
        points: t.points,
    })),
    tricksWon: { ...g.tricksWon },
    pointsTaken: { ...g.pointsTaken },
    scores: { ...g.scores },
});

// ---------------------------------------------------------------------------
// Derived knowledge — the "memory" a careful human keeps at the table.
// ---------------------------------------------------------------------------

/** Every card the observer has seen face-up or holds. */
export const seenCards = (o: Observation): Card[] => [
    ...o.completedTricks.flatMap((t) => t.plays.map((p) => p.card)),
    ...o.trickPlays.map((p) => p.card),
    ...o.hand,
    ...(o.myGoDown ?? []),
];

/** Cards whose location the observer does not know. */
export const unseenCards = (o: Observation): Card[] => {
    const seen = new Set(seenCards(o).map((c) => `${c.suit}-${c.number}`));
    const out: Card[] = [];
    for (const suit of SUITS) {
        for (let n = 5; n <= 14; n++) {
            if (!seen.has(`${suit}-${n}`)) out.push({ suit, number: n });
        }
    }
    return out;
};

/** Suits each opponent/partner has shown they are out of (failed to follow). */
export const knownVoids = (o: Observation): Record<Seat, Set<Suit>> => {
    const voids: Record<Seat, Set<Suit>> = {
        A1: new Set(), B1: new Set(), A2: new Set(), B2: new Set(),
    };
    const allTricks = [
        ...o.completedTricks.map((t) => t.plays),
        ...(o.trickPlays.length > 0 ? [o.trickPlays] : []),
    ];
    for (const plays of allTricks) {
        if (plays.length === 0) continue;
        const lead = plays[0].card.suit;
        for (const p of plays) {
            if (p.card.suit !== lead) voids[p.seat].add(lead);
        }
    }
    return voids;
};

/** How many cards each seat is currently holding. */
export const handSizes = (o: Observation): Record<Seat, number> => {
    const playedThisTrick = new Set(o.trickPlays.map((p) => p.seat));
    const base = 9 - o.completedTricks.length;
    return {
        A1: base - (playedThisTrick.has('A1') ? 1 : 0),
        B1: base - (playedThisTrick.has('B1') ? 1 : 0),
        A2: base - (playedThisTrick.has('A2') ? 1 : 0),
        B2: base - (playedThisTrick.has('B2') ? 1 : 0),
    };
};
