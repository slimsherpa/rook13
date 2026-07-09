// The AlphaRook seat drivers.
//
// 'gen7' / 'gen8' — the trained brains (ml/ Deep Monte Carlo, frozen
// champions): one QNet forward pass per candidate for bidding and card play,
// go-down/trump by the family heuristic — exactly the configuration their
// arena results were measured in (gen8: 87.5% vs Standard, beats gen7 63/37).
// Weights load async from /models/<gen>.bin, so the entry point is
// nextAgentActionAsync; if the weights can't be fetched the seat falls back
// to the Standard heuristic rather than stalling the family's game.
//
// 'alpharook' — the phase-1/2 PIMC search bot, kept so game docs created
// before the neural bots keep playing (~4ms per card, ~15ms per bid).

import { GameDoc, GameAction, Seat, VALID_BIDS, BotStyle } from '../game/types';
import { nextBotAction } from '../game/bots';
import { legalCards, minNextBid, mustBid } from '../game/engine';
import { observe } from './observation';
import { choosePIMCCard, choosePIMCBid } from './pimc';
import {
    encodeState, encodeAction, cardToInt, intToCard, D_BID, D_PLAY, PASS,
} from './encoder';
import { QNetWeights, qForward, loadQNet, NeuralGen } from './qnet';

export const ALPHAROOK_SAMPLES = 25;
export const ALPHAROOK_BID_SAMPLES = 20;

export const isNeuralStyle = (s: BotStyle | undefined): s is NeuralGen =>
    s === 'gen7' || s === 'gen8';

export interface NeuralChoice {
    dtype: number;
    /** candidates in the training env's order: bids (PASS first), or card ints */
    cands: number[];
    q: number[];
    chosen: number;
}

/**
 * The net's pick for a bidding/playing decision, or null in other phases
 * (where the family heuristic handles the seat via nextBotAction).
 * Candidate construction mirrors ml/alpharook/env.py `decision()` exactly —
 * q ties break by first-max, so ordering is part of the model contract.
 */
export const neuralChoice = (g: GameDoc, seat: Seat, net: QNetWeights): NeuralChoice | null => {
    let dtype: number;
    let cands: number[];
    if (g.phase === 'bidding') {
        dtype = D_BID;
        const floor = minNextBid(g);
        if (floor === null) cands = [PASS];
        else {
            cands = VALID_BIDS.filter((b) => b >= floor);
            if (!mustBid(g)) cands = [PASS, ...cands];
        }
    } else if (g.phase === 'playing') {
        dtype = D_PLAY;
        cands = legalCards(g, seat).map(cardToInt);
    } else {
        return null;
    }

    const state = encodeState(observe(g, seat), [], dtype, {
        mustBid: mustBid(g),
        minNextBid: minNextBid(g),
    });
    const q = cands.map((c) => qForward(net, state, encodeAction(dtype, c)));
    let best = 0;
    for (let i = 1; i < q.length; i++) if (q[i] > q[best]) best = i; // first max, like torch.argmax
    return { dtype, cands, q, chosen: cands[best] };
};

const neuralAction = (g: GameDoc, seat: Seat, net: QNetWeights): GameAction | null => {
    const d = neuralChoice(g, seat, net);
    if (!d) return null;
    if (d.dtype === D_BID) {
        return { type: 'BID', seat, bid: d.chosen === PASS ? 'pass' : d.chosen };
    }
    return { type: 'PLAY_CARD', seat, card: intToCard(d.chosen) };
};

/** Warm the weight cache for any neural bots seated in this game. */
export const preloadNets = (g: GameDoc): void => {
    for (const seat of Object.values(g.seats)) {
        if (seat.kind === 'bot' && isNeuralStyle(seat.botStyle)) {
            loadQNet(seat.botStyle).catch(() => {});
        }
    }
};

/** When the game is waiting on a bot, produce its action; otherwise null. */
export const nextAgentActionAsync = async (g: GameDoc): Promise<GameAction | null> => {
    if (g.status === 'active' && g.turn) {
        const info = g.seats[g.turn];
        if (info.kind === 'bot' && isNeuralStyle(info.botStyle) &&
            (g.phase === 'bidding' || g.phase === 'playing')) {
            try {
                const net = await loadQNet(info.botStyle);
                const action = neuralAction(g, g.turn, net);
                if (action) return action;
            } catch (e) {
                console.error(`AlphaRook ${info.botStyle} weights unavailable — playing the hand heuristically`, e);
            }
        }
    }
    return nextAgentAction(g);
};

/** Sync driver for heuristic + legacy PIMC seats (and the neural fallback). */
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
