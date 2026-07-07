// AlphaRook v0: Perfect-Information Monte Carlo card play (the GIB/bridge
// approach). For each legal card, imagine K complete worlds consistent with
// everything legally observed (see determinize.ts), play each one out with
// the heuristic bots, and pick the card with the best average hand score.
//
// The agent sees only an Observation — it cannot cheat even by accident.
// Bidding, go-down, and trump still use the heuristic brain in v0; search
// (and later, learning) takes over once the cards start hitting the table.

import { Card, VALID_BIDS, teamOf } from '../game/types';
import { Observation } from './observation';
import { sampleWorld, World } from './determinize';
import {
    materialize, materializeAuction, applyPlayFast, applyBidFast,
    playOut, playOutHand, valueFor,
} from './rollout';

/** Legal cards from the observation alone (follow suit if you can). */
export const legalFromObservation = (o: Observation): Card[] => {
    const lead = o.trickPlays.length > 0 ? o.trickPlays[0].card.suit : null;
    if (!lead) return o.hand;
    const followers = o.hand.filter((c) => c.suit === lead);
    return followers.length > 0 ? followers : o.hand;
};

export interface PIMCOptions {
    /** consistent worlds sampled per decision */
    samples: number;
}

/** Choose a card by determinized Monte Carlo search. */
export const choosePIMCCard = (o: Observation, opts: PIMCOptions = { samples: 12 }): Card => {
    const legal = legalFromObservation(o);
    if (legal.length === 1) return legal[0];

    const myTeam = teamOf(o.seat);
    const totals = new Array(legal.length).fill(0);

    for (let k = 0; k < opts.samples; k++) {
        const world: World = sampleWorld(o);
        for (let i = 0; i < legal.length; i++) {
            const g = materialize(o, world);
            applyPlayFast(g, o.seat, legal[i]);
            playOut(g);
            totals[i] += valueFor(g, myTeam);
        }
    }

    let best = 0;
    for (let i = 1; i < legal.length; i++) {
        if (totals[i] > totals[best]) best = i;
    }
    return legal[best];
};

/**
 * Choose a bid by determinized Monte Carlo: for each candidate (pass, the
 * minimum raise, and a statement jump), sample K worlds and play the entire
 * rest of the hand out — remaining auction, widow, go-down, all nine tricks
 * — then take the candidate with the best average hand score. This is what
 * makes the bid honest: it prices the widow, the partner, and the risk of
 * going set by simulation instead of a formula.
 */
export const choosePIMCBid = (o: Observation, opts: PIMCOptions = { samples: 20 }): number | 'pass' => {
    const passes = Object.values(o.bids).filter((b) => b === 'pass').length;
    if (passes === 3 && o.highBid === null) return VALID_BIDS[0]; // forced

    const floor = o.highBid === null ? VALID_BIDS[0] : o.highBid + 5;
    if (floor > VALID_BIDS[VALID_BIDS.length - 1]) return 'pass';

    // pass, the minimum raise, and a ladder of jump rungs — the search picks
    // the level, including jumping to shut an auction down early
    const candidates: (number | 'pass')[] = ['pass', floor];
    for (const jump of [floor + 10, floor + 20, floor + 30]) {
        if (jump <= 120) candidates.push(jump);
    }

    const totals = new Array(candidates.length).fill(0);
    for (let k = 0; k < opts.samples; k++) {
        const world: World = sampleWorld(o);
        for (let i = 0; i < candidates.length; i++) {
            const g = materializeAuction(o, world);
            applyBidFast(g, o.seat, candidates[i]);
            playOutHand(g);
            totals[i] += valueFor(g, teamOf(o.seat));
        }
    }

    let best = 0;
    for (let i = 1; i < candidates.length; i++) {
        if (totals[i] > totals[best]) best = i;
    }
    return candidates[best];
};
