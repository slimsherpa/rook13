// Blunder reports: a player (or watcher) flags one specific decision in a
// finished hand — a bid, the go-down, the trump call, or a played card — as a
// mistake, for AlphaRook's training queue. A target pins the exact action so
// the trainer can replay the game log (games/{id}/actions) up to that moment
// and see precisely what the actor knew when they blew it.

import { Card, Seat, Suit } from './types';

export type BlunderTarget =
    | { kind: 'bid'; seat: Seat; bid: number | 'pass'; nth: number } // nth bid by this seat this hand
    | { kind: 'godown'; seat: Seat; cards: Card[] }
    | { kind: 'trump'; seat: Seat; suit: Suit }
    | { kind: 'play'; seat: Seat; card: Card; trick: number };       // trick is 0-indexed

/** Stable identity for a target within one hand — used to mark already-reported
 *  actions in the review UI. */
export const targetKey = (t: BlunderTarget): string => {
    switch (t.kind) {
        case 'bid': return `bid:${t.seat}:${t.nth}`;
        case 'godown': return `godown:${t.seat}`;
        case 'trump': return `trump:${t.seat}`;
        case 'play': return `play:${t.trick}:${t.seat}`;
    }
};

/** "Marty's bid of 105", "Marty playing the Green 12 in trick 4" — the phrase
 *  the confirm sheet and the report list build their sentences around. */
export const describeTarget = (t: BlunderTarget, name: string): string => {
    switch (t.kind) {
        case 'bid':
            return t.bid === 'pass' ? `${name}'s pass` : `${name}'s bid of ${t.bid}`;
        case 'godown':
            return `${name}'s go-down`;
        case 'trump':
            return `${name} calling ${t.suit} trump`;
        case 'play':
            return `${name} playing the ${t.card.suit} ${t.card.number} in trick ${t.trick + 1}`;
    }
};
