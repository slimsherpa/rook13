// AlphaRook v0: Perfect-Information Monte Carlo card play (the GIB/bridge
// approach). For each legal card, imagine K complete worlds consistent with
// everything legally observed (see determinize.ts), play each one out with
// the heuristic bots, and pick the card with the best average hand score.
//
// The agent sees only an Observation — it cannot cheat even by accident.
// Bidding, go-down, and trump still use the heuristic brain in v0; search
// (and later, learning) takes over once the cards start hitting the table.

import { Card, Seat, teamOf } from '../game/types';
import { Observation } from './observation';
import { sampleWorld, World } from './determinize';
import { materialize, applyPlayFast, playOut, valueFor } from './rollout';

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
