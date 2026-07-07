// The AlphaRook seat driver: a drop-in replacement for nextBotAction that
// gives 'alpharook' bots their search brain for card play. Everything else
// (dealing, bidding, widow, trump) delegates to the heuristic bots — those
// phases are the next frontier for search/learning.
//
// PIMC at 25 samples costs ~4ms per decision, so it runs live in the browser
// with room to spare (bot moves are paced ~1s apart for humans anyway).

import { GameDoc, GameAction } from '../game/types';
import { nextBotAction } from '../game/bots';
import { observe } from './observation';
import { choosePIMCCard } from './pimc';

export const ALPHAROOK_SAMPLES = 25;

export const nextAgentAction = (g: GameDoc): GameAction | null => {
    if (g.status === 'active' && g.phase === 'playing' && g.turn) {
        const info = g.seats[g.turn];
        if (info.kind === 'bot' && info.botStyle === 'alpharook') {
            const card = choosePIMCCard(observe(g, g.turn), { samples: ALPHAROOK_SAMPLES });
            return { type: 'PLAY_CARD', seat: g.turn, card };
        }
    }
    return nextBotAction(g);
};
