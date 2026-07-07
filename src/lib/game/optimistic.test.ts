import { describe, it, expect } from 'vitest';
import { GameDoc, Card, Suit } from './types';
import { isValidDeck } from './deck';
import { createGameDoc, applyAction } from './engine';
import { overlayPending, sameAction } from './optimistic';

const host = { uid: 'u-host', name: 'Riley' };

const c = (suit: Suit, number: number): Card => ({ suit, number });

/** Deterministic non-redeal deck: suits dealt in blocks, widow = the four 14s. */
const blockDeck = (): Card[] => {
    const nums = (suit: Suit) => Array.from({ length: 10 }, (_, i) => c(suit, i + 5));
    const [r, y, b, g] = [nums('Red'), nums('Yellow'), nums('Black'), nums('Green')];
    const deck = [
        ...r.slice(0, 9), ...y.slice(0, 9), ...b.slice(0, 9), ...g.slice(0, 9),
        c('Red', 14), c('Yellow', 14), c('Black', 14), c('Green', 14),
    ];
    if (!isValidDeck(deck)) throw new Error('test deck is not a valid 40-card deck');
    return deck;
};

/** A game advanced to the widow phase (one bid of 65, three passes). */
const toWidow = (): GameDoc => {
    let g = createGameDoc({ id: 'test-game', joinCode: 'ABCD', host, now: 1000 });
    g = applyAction(g, { type: 'START_GAME' });
    g = applyAction(g, { type: 'DEAL', deck: blockDeck() });
    g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 65 });
    while (g.phase === 'bidding') {
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
    }
    return g;
};

/** A game advanced to trick play. */
const toPlaying = (): GameDoc => {
    let g = toWidow();
    const winner = g.bidWinner!;
    g = applyAction(g, { type: 'SELECT_GODOWN', seat: winner, cards: g.hands[winner].slice(9, 13) });
    g = applyAction(g, { type: 'SELECT_TRUMP', seat: winner, suit: g.hands[winner][0].suit });
    return g;
};

describe('overlayPending', () => {
    it('shows an in-flight play immediately: card leaves the hand and lands on the trick', () => {
        const server = toPlaying();
        const seat = server.turn!;
        const card = server.hands[seat][0];
        const pending = [{ id: 1, action: { type: 'PLAY_CARD', seat, card } as const }];

        const { game, survivors } = overlayPending(server, pending);

        expect(game.trickPlays).toContainEqual({ seat, card });
        expect(game.hands[seat]).not.toContainEqual(card);
        expect(game.actionCount).toBe(server.actionCount + 1);
        expect(survivors).toHaveLength(1);
    });

    it('retires a pending action once the server state includes it', () => {
        const before = toPlaying();
        const seat = before.turn!;
        const card = before.hands[seat][0];
        const action = { type: 'PLAY_CARD', seat, card } as const;
        // the transaction committed and the snapshot arrived
        const server = applyAction(before, action);

        const { game, survivors } = overlayPending(server, [{ id: 1, action }]);

        expect(survivors).toHaveLength(0);
        expect(game).toBe(server); // no overlay applied at all
        expect(game.trickPlays.filter((p) => p.seat === seat)).toHaveLength(1); // never doubled
    });

    it('retires a confirmed action by actionCount without replaying it', () => {
        const before = toPlaying();
        const seat = before.turn!;
        const card = before.hands[seat][0];
        const action = { type: 'PLAY_CARD', seat, card } as const;
        const server = applyAction(before, action);

        const { survivors } = overlayPending(server, [
            { id: 1, action, confirmedCount: server.actionCount },
        ]);
        expect(survivors).toHaveLength(0);
    });

    it('replays a chain of pending actions in order (go-down then trump)', () => {
        const server = toWidow();
        const winner = server.bidWinner!;
        const pending = [
            { id: 1, action: { type: 'SELECT_GODOWN', seat: winner, cards: server.hands[winner].slice(9, 13) } as const },
            { id: 2, action: { type: 'SELECT_TRUMP', seat: winner, suit: 'Red' } as const },
        ];

        const { game, survivors } = overlayPending(server, pending);

        expect(game.phase).toBe('playing');
        expect(game.trump).toBe('Red');
        expect(survivors).toHaveLength(2);
    });

    it('drops a pending action that is no longer legal, leaving the server state intact', () => {
        const server = toPlaying();
        const seat = server.turn!;
        const notMyCard = server.hands[seat === 'A1' ? 'B1' : 'A1'][0];
        const pending = [{ id: 1, action: { type: 'PLAY_CARD', seat, card: notMyCard } as const }];

        const { game, survivors } = overlayPending(server, pending);

        expect(survivors).toHaveLength(0);
        expect(game).toBe(server);
    });
});

describe('sameAction', () => {
    it('matches identical actions and rejects different ones', () => {
        const server = toPlaying();
        const seat = server.turn!;
        const [a, b] = server.hands[seat];
        expect(sameAction(
            { type: 'PLAY_CARD', seat, card: a },
            { type: 'PLAY_CARD', seat, card: { ...a } },
        )).toBe(true);
        expect(sameAction(
            { type: 'PLAY_CARD', seat, card: a },
            { type: 'PLAY_CARD', seat, card: b },
        )).toBe(false);
    });
});
