import { describe, it, expect } from 'vitest';
import { GameAction, GameDoc } from './types';
import { createGameDoc, applyAction, legalCards, mustBid } from './engine';
import { createShuffledDeck } from './deck';
import { nextBotAction } from './bots';
import { reconstructGame } from './review';

const host = { uid: 'u-host', name: 'Riley' };

/**
 * Play a full game exactly the way production does — host human at A1, bots
 * everywhere else, every mutation recorded as an action — then rebuild it
 * from the log alone.
 */
const playAndLog = (id: string): { final: GameDoc; log: GameAction[] } => {
    let g = createGameDoc({ id, joinCode: 'REVW', host, now: 1 });
    const log: GameAction[] = [];
    const act = (a: GameAction) => { log.push(a); g = applyAction(g, a); };

    act({ type: 'SET_BOT', seat: 'B1', botStyle: 'basic' });
    act({ type: 'SET_BOT', seat: 'A2', botStyle: 'aggressive' });
    act({ type: 'SET_BOT', seat: 'B2', botStyle: 'cautious' });
    act({ type: 'START_GAME' });

    let safety = 20000;
    while (g.status === 'active' && safety-- > 0) {
        if (g.phase === 'hand_done') { act({ type: 'NEXT_HAND' }); continue; }
        const bot = nextBotAction(g);
        if (bot) { act(bot); continue; }
        // the human host's turn: play simply but legally
        switch (g.phase) {
            case 'dealing': act({ type: 'DEAL', deck: createShuffledDeck() }); break;
            case 'redeal': act({ type: 'ACK_REDEAL', deck: createShuffledDeck() }); break;
            case 'bidding': act({ type: 'BID', seat: 'A1', bid: mustBid(g) ? 65 : 'pass' }); break;
            case 'widow': act({ type: 'SELECT_GODOWN', seat: 'A1', cards: g.hands.A1.slice(0, 4) }); break;
            case 'trump': act({ type: 'SELECT_TRUMP', seat: 'A1', suit: g.hands.A1[0].suit }); break;
            case 'playing': act({ type: 'PLAY_CARD', seat: 'A1', card: legalCards(g, 'A1')[0] }); break;
            default: throw new Error(`unexpected phase ${g.phase}`);
        }
    }
    if (safety <= 0) throw new Error('game did not terminate');
    return { final: g, log };
};

describe('game review reconstruction', () => {
    it('rebuilds every hand with 9 tricks and matching summaries', () => {
        for (let i = 0; i < 3; i++) {
            const { final, log } = playAndLog(`review-sim-${i}`);
            const review = reconstructGame(final, log);
            expect(review.complete).toBe(true);
            expect(review.hands.length).toBe(final.handHistory.length);
            review.hands.forEach((h, idx) => {
                expect(h.tricks).toHaveLength(9);
                expect(h.summary).toEqual(final.handHistory[idx]);
                expect(h.goDown).toHaveLength(4);
                expect(h.bids.length).toBeGreaterThanOrEqual(4);
            });
        }
    });

    it('degrades gracefully on a divergent log', () => {
        const { final, log } = playAndLog('review-broken');
        // corrupt the log: drop an early action so replay goes illegal
        const broken = [...log.slice(0, 5), ...log.slice(6)];
        const review = reconstructGame(final, broken);
        expect(review.complete).toBe(false);
    });
});
