// The AlphaRook seat driver: a drop-in replacement for nextBotAction that
// gives 'alpharook' bots their search brain for bidding and card play.
// Widow/trump still delegate to the heuristics (the go-down optimizer and
// the longest-suit family law) — candidates for search in a later phase.
//
// PIMC costs ~4ms per card decision and ~15ms per bid decision, so it runs
// live in the browser with room to spare (bot moves are paced ~1s apart for
// humans anyway).

import { GameDoc, GameAction } from '../game/types';
import { nextBotAction } from '../game/bots';
import { observe } from './observation';
import { choosePIMCCard, choosePIMCBid } from './pimc';

export const ALPHAROOK_SAMPLES = 25;
export const ALPHAROOK_BID_SAMPLES = 20;

export const nextAgentAction = (g: GameDoc): GameAction | null => {
    if (g.status === 'active' && g.turn) {
        const info = g.seats[g.turn];
        if (info.kind === 'bot' && info.botStyle === 'alpharook') {
            if (g.phase === 'playing') {
                const card = choosePIMCCard(observe(g, g.turn), { samples: ALPHAROOK_SAMPLES });
                return { type: 'PLAY_CARD', seat: g.turn, card };
            }
            if (g.phase === 'bidding') {
                const bid = choosePIMCBid(observe(g, g.turn), { samples: ALPHAROOK_BID_SAMPLES });
                return { type: 'BID', seat: g.turn, bid };
            }
        }
    }
    return nextBotAction(g);
};
