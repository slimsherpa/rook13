// The AlphaRook seat drivers.
//
// 'gen11' — the champion: gen10's weights with PIMC look-ahead bolted onto
// endgame card play (search.ts). Same brain file as gen10 — the strength is
// calculation. Beats pure gen10 54% duplicate-deck (65/35 marathon in the
// Python lab, ml/alpharook/search.py).
//
// 'gen9' — the first FULLY neural brain: bids,
// trump intent, go-down, and card play are all QNet decisions (beat gen8
// 57.5% over 400 duplicate-deck games). At the widow it declares a private
// trump intent first, then picks its four discards knowing the plan — and at
// the trump phase the intent is re-derived deterministically from the same
// 13-card state (hand + go-down, both its own information), so the driver
// stays stateless between actions.
//
// 'gen7' / 'gen8' — earlier frozen champions: neural bidding and card play,
// go-down/trump by the family heuristic — exactly the configuration their
// arena results were measured in (gen8: 87.5% vs Standard, beats gen7 63/37).
//
// Weights load async from /models/<gen>.bin, so the entry point is
// nextAgentActionAsync; if the weights can't be fetched the seat falls back
// to the Standard heuristic rather than stalling the family's game.
//
// 'alpharook' — the phase-1/2 PIMC search bot, kept so game docs created
// before the neural bots keep playing (~4ms per card, ~15ms per bid).

import { GameDoc, GameAction, Seat, SUITS, VALID_BIDS, BotStyle } from '../game/types';
import { nextBotAction } from '../game/bots';
import { legalCards, minNextBid, mustBid } from '../game/engine';
import { Observation, observe } from './observation';
import { choosePIMCCard, choosePIMCBid } from './pimc';
import {
    encodeState, encodeAction, cardToInt, intToCard, AuctionContext,
    D_BID, D_DISCARD, D_TRUMP, D_PLAY, PASS,
} from './encoder';
import { QNetWeights, qForward, loadQNet, NeuralGen } from './qnet';
import { chooseSearchCard, GEN11_SEARCH } from './search';

export const ALPHAROOK_SAMPLES = 25;
export const ALPHAROOK_BID_SAMPLES = 20;

/** Styles driven by a QNet (gen11 runs on gen10's weight file). */
export type NeuralStyle = NeuralGen | 'gen11';

export const isNeuralStyle = (s: BotStyle | undefined): s is NeuralStyle =>
    s === 'gen7' || s === 'gen8' || s === 'gen9' || s === 'gen10' || s === 'gen11';

/** Which weight file a neural style runs on. */
export const weightsGenFor = (s: NeuralStyle): NeuralGen =>
    s === 'gen11' ? 'gen10' : s;

/** Generations whose go-down/trump are ALSO net decisions (gen9+). */
export const isFullyNeural = (s: BotStyle | undefined): boolean =>
    s === 'gen9' || s === 'gen10' || s === 'gen11';

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

const argmaxChoice = (
    net: QNetWeights, o: Observation, picks: number[], dtype: number,
    cands: number[], ctx: AuctionContext, trumpIntent: number | null,
): NeuralChoice => {
    const state = encodeState(o, picks, dtype, ctx, trumpIntent);
    const q = cands.map((c) => qForward(net, state, encodeAction(dtype, c)));
    let best = 0;
    for (let i = 1; i < q.length; i++) if (q[i] > q[best]) best = i;
    return { dtype, cands, q, chosen: cands[best] };
};

const auctionCtx = (g: GameDoc): AuctionContext => ({
    mustBid: mustBid(g),
    minNextBid: minNextBid(g),
});

/**
 * The fully-neural widow sequence, mirroring ml/alpharook/env.py: declare a
 * trump intent (suits in 0..3 order), then pick 4 discards one at a time
 * with the intent and picks-so-far in the state. Candidate order = current
 * hand order, exactly like the training env (tie-breaks are part of the
 * model contract).
 */
export const neuralWidow = (
    g: GameDoc, seat: Seat, net: QNetWeights,
): { intent: NeuralChoice; picks: NeuralChoice[]; goDown: number[] } => {
    const o = observe(g, seat);
    const ctx = auctionCtx(g);
    const intent = argmaxChoice(net, o, [], D_TRUMP, [0, 1, 2, 3], ctx, null);
    const picks: NeuralChoice[] = [];
    const chosen: number[] = [];
    for (let k = 0; k < 4; k++) {
        const cands = o.hand.map(cardToInt).filter((c) => !chosen.includes(c));
        const p = argmaxChoice(net, o, chosen, D_DISCARD, cands, ctx, intent.chosen);
        picks.push(p);
        chosen.push(p.chosen);
    }
    return { intent, picks, goDown: chosen };
};

/**
 * Trump-phase intent, re-derived from the same information the widow-time
 * intent used: the 13-card state (current hand + the go-down I just chose,
 * both mine to see). Deterministic net + identical inputs = identical suit,
 * with no state carried between actions.
 */
export const neuralTrumpIntent = (g: GameDoc, seat: Seat, net: QNetWeights): NeuralChoice => {
    const o = observe(g, seat);
    const o13: Observation = {
        ...o,
        hand: [...o.hand, ...(o.myGoDown ?? [])],
        myGoDown: [],
    };
    return argmaxChoice(net, o13, [], D_TRUMP, [0, 1, 2, 3], auctionCtx(g), null);
};

const neuralAction = (g: GameDoc, seat: Seat, gen: NeuralStyle, net: QNetWeights): GameAction | null => {
    // gen11 = gen10 + look-ahead: endgame card plays go through PIMC search
    // (8 imagined worlds, net rollouts); everything else is the gen10 reflex
    if (gen === 'gen11' && g.phase === 'playing'
            && g.completedTricks.length >= GEN11_SEARCH.minTrick) {
        const d = chooseSearchCard(g, net, GEN11_SEARCH);
        const note = d.overrode ? ', search overrode the reflex' : '';
        console.info(`🔮 gen11 ${seat} searched ${GEN11_SEARCH.worlds} worlds, `
            + `plays ${d.card.suit} ${d.card.number} `
            + `(score ${Math.max(...d.scores).toFixed(3)}${note})`);
        return { type: 'PLAY_CARD', seat, card: d.card };
    }
    if (isFullyNeural(gen)) {
        if (g.phase === 'widow' && g.bidWinner === seat) {
            const w = neuralWidow(g, seat, net);
            console.info(`🧠 ${gen} ${seat} plans ${SUITS[w.intent.chosen]} trump, buries 4 (q ${Math.max(...w.intent.q).toFixed(3)})`);
            return { type: 'SELECT_GODOWN', seat, cards: w.goDown.map(intToCard) };
        }
        if (g.phase === 'trump' && g.bidWinner === seat) {
            const d = neuralTrumpIntent(g, seat, net);
            console.info(`🧠 ${gen} ${seat} declares ${SUITS[d.chosen]} trump (q ${Math.max(...d.q).toFixed(3)})`);
            return { type: 'SELECT_TRUMP', seat, suit: SUITS[d.chosen] };
        }
    }
    const d = neuralChoice(g, seat, net);
    if (!d) return null;
    // one console line per decision — open DevTools on rook13.com and watch
    // the brain think; q is the net's expected game result for the choice
    const q = Math.max(...d.q).toFixed(3);
    if (d.dtype === D_BID) {
        const bid = d.chosen === PASS ? 'pass' : d.chosen;
        console.info(`🧠 ${gen} ${seat} bids ${bid} (q ${q}, ${d.cands.length} options)`);
        return { type: 'BID', seat, bid: d.chosen === PASS ? 'pass' : d.chosen };
    }
    const card = intToCard(d.chosen);
    console.info(`🧠 ${gen} ${seat} plays ${card.suit} ${card.number} (q ${q}, ${d.cands.length} options)`);
    return { type: 'PLAY_CARD', seat, card };
};

/** Warm the weight cache for any neural bots seated in this game. */
export const preloadNets = (g: GameDoc): void => {
    for (const seat of Object.values(g.seats)) {
        if (seat.kind === 'bot' && isNeuralStyle(seat.botStyle)) {
            loadQNet(weightsGenFor(seat.botStyle)).catch(() => {});
        }
    }
};

/** When the game is waiting on a bot, produce its action; otherwise null. */
export const nextAgentActionAsync = async (g: GameDoc): Promise<GameAction | null> => {
    if (g.status === 'active' && g.turn) {
        const info = g.seats[g.turn];
        if (info.kind === 'bot' && isNeuralStyle(info.botStyle) &&
            (g.phase === 'bidding' || g.phase === 'playing' ||
             (isFullyNeural(info.botStyle) && (g.phase === 'widow' || g.phase === 'trump')))) {
            try {
                const net = await loadQNet(weightsGenFor(info.botStyle));
                const action = neuralAction(g, g.turn, info.botStyle, net);
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
