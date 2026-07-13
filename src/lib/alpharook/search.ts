// gen11 in the browser: the gen10 brain inside PIMC look-ahead — instinct
// times calculation, the AlphaZero recipe (ml/alpharook/search.py, ported).
//
// Only card play is searched, and only from trick 5 on (completedTricks >=
// 4): that's where voids and played cards pin the hidden hands down and
// imagined worlds are nearly exact. Early diffuse tricks stay pure reflex —
// measured in Python duels, searching them LOSES to the trained instinct.
// This exact config (K=8 worlds, Q-prior weight 2, trick gate 4) beat pure
// gen10 54.0% over 100 duplicate-deck games (sweeps 6-2).
//
// Two lessons baked in from the Python lab:
//  - raw argmax over K noisy rollout means suffers the winner's curse, so
//    candidates are scored (rollout_sum + w*Q) / (K + w): the champion's
//    calibrated instinct counts as w pseudo-rollouts and search only
//    overrides the reflex when the look-ahead evidence is real;
//  - rollout values live on the net's own training-target scale
//    (0.5*hand + 0.5*game term), so the blend is apples to apples.

import {
    GameDoc, Card, Team, WIN_SCORE, LOSE_SCORE, TRICKS_PER_HAND, teamOf,
} from '../game/types';
import { legalCards, minNextBid, mustBid } from '../game/engine';
import { Observation, observe } from './observation';
import { sampleWorld } from './determinize';
import { materialize, applyPlayFast, scoreHand } from './rollout';
import { legalFromObservation } from './pimc';
import { encodeStateFor, encodeAction, cardToInt, D_PLAY } from './encoder';
import { QNetWeights, qForward } from './qnet';

export interface SearchOptions {
    /** consistent worlds sampled per searched decision */
    worlds: number;
    /** pseudo-rollout weight of the net's own Q at the root */
    prior: number;
    /** only search plays once this many tricks are complete */
    minTrick: number;
}

/** The shipped gen11 configuration (Python-duel-validated: 54% vs gen10). */
export const GEN11_SEARCH: SearchOptions = { worlds: 8, prior: 2, minTrick: 4 };

const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));

const playCtx = (g: GameDoc) => ({ mustBid: mustBid(g), minNextBid: minNextBid(g) });

/** Net-greedy card for the seat to act in a rollout game (argmax Q). */
export const netCard = (g: GameDoc, net: QNetWeights): Card => {
    const seat = g.turn!;
    const legal = legalCards(g, seat);
    if (legal.length === 1) return legal[0];
    const state = encodeStateFor(net, observe(g, seat), [], D_PLAY, playCtx(g));
    let best = 0;
    let bestQ = -Infinity;
    for (let i = 0; i < legal.length; i++) {
        const q = qForward(net, state, encodeAction(D_PLAY, cardToInt(legal[i])));
        if (q > bestQ) { bestQ = q; best = i; }
    }
    return legal[best];
};

/** Play a materialized world to the end of the hand, every seat net-greedy. */
export const netPlayOut = (g: GameDoc, net: QNetWeights): void => {
    let safety = 40;
    while (g.completedTricks.length < TRICKS_PER_HAND && safety-- > 0) {
        applyPlayFast(g, g.turn!, netCard(g, net));
    }
    if (safety <= 0) throw new Error('net rollout did not terminate');
};

/**
 * What one finished rollout hand is worth, on the net's training-target
 * scale: 0.5 * clipped hand diff + 0.5 * game term. Mid-game the win/loss
 * part is unknown and drops out (identical across candidates); a hand that
 * ENDS the game keeps it, so search plays protectively at 460 and
 * desperately at -190. Port of ml/alpharook/search.py rollout_value.
 */
export const rolloutValue = (g: GameDoc, myTeam: Team): number => {
    const other: Team = myTeam === 'A' ? 'B' : 'A';
    const hs = scoreHand(g);
    const hand = clamp1((hs[myTeam] - hs[other]) / 200);
    const mine = g.scores[myTeam] + hs[myTeam];
    const theirs = g.scores[other] + hs[other];
    let game = 0.3 * clamp1((mine - theirs) / WIN_SCORE);
    const over = (mine >= WIN_SCORE || theirs >= WIN_SCORE
        || mine <= LOSE_SCORE || theirs <= LOSE_SCORE) && mine !== theirs;
    if (over) game += 0.7 * (mine > theirs ? 1 : -1);
    return 0.5 * hand + 0.5 * game;
};

export interface SearchChoice {
    card: Card;
    /** blended (rollout + prior) score per legal card, root order */
    scores: number[];
    /** the reflex net's own Q per legal card (what gen10 would think) */
    prior: number[];
    /** true when look-ahead overrode the reflex argmax */
    overrode: boolean;
}

/**
 * Choose a card by neural PIMC: for each legal card, imagine K complete
 * worlds consistent with the observation, play each out with the NET making
 * every remaining decision for all four seats, and blend the average
 * outcome with the net's own Q. The observation is all it ever sees —
 * worlds are sampled from public information only.
 */
export const chooseSearchCard = (
    g: GameDoc,
    net: QNetWeights,
    opts: SearchOptions = GEN11_SEARCH,
    rand: () => number = Math.random,
): SearchChoice => {
    const seat = g.turn!;
    const o: Observation = observe(g, seat);
    const legal = legalFromObservation(o);
    const myTeam = teamOf(seat);

    const rootState = encodeStateFor(net, o, [], D_PLAY, playCtx(g));
    const prior = legal.map((c) =>
        qForward(net, rootState, encodeAction(D_PLAY, cardToInt(c))));

    if (legal.length === 1) {
        return { card: legal[0], scores: [...prior], prior, overrode: false };
    }

    const totals = new Array(legal.length).fill(0);
    for (let k = 0; k < opts.worlds; k++) {
        // same world across candidates: apples-to-apples inside each guess
        const world = sampleWorld(o, rand);
        for (let i = 0; i < legal.length; i++) {
            const sim = materialize(o, world);
            applyPlayFast(sim, seat, legal[i]);
            if (sim.completedTricks.length < TRICKS_PER_HAND) netPlayOut(sim, net);
            totals[i] += rolloutValue(sim, myTeam);
        }
    }

    const w = opts.prior;
    const scores = totals.map((t, i) => (t + w * prior[i]) / (opts.worlds + w));
    let best = 0;
    let reflex = 0;
    for (let i = 1; i < legal.length; i++) {
        if (scores[i] > scores[best]) best = i;
        if (prior[i] > prior[reflex]) reflex = i;
    }
    return { card: legal[best], scores, prior, overrode: best !== reflex };
};
