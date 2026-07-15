// When did the hand turn? The trick after which the bidding team could no
// longer reach its bid — even taking every remaining counter, the go-down,
// and the 5-trick bonus. Mirrors the live engine's bidTeamMaxPoints exactly
// (100 card points in the deck, a 20-point bonus for taking 5+ tricks), so
// the recap's "…got SET!" beat lands on the same trick the table would have.

import { HandSummary, TrickRecord, Team, teamOf } from './types';

/** 0-indexed sealing trick, or -1 when the hand wasn't set. */
export const setSealedTrick = (tricks: TrickRecord[], h: HandSummary): number => {
    if (!h.wentSet) return -1;
    const bidTeam = teamOf(h.bidWinner);
    const defTeam: Team = bidTeam === 'A' ? 'B' : 'A';
    let defBanked = 0;
    let bidTricks = 0;
    for (let k = 0; k < tricks.length; k++) {
        if (teamOf(tricks[k].winner) === defTeam) defBanked += tricks[k].points;
        if (teamOf(tricks[k].winner) === bidTeam) bidTricks += 1;
        const tricksLeft = tricks.length - (k + 1);
        const bonusReachable = bidTricks + tricksLeft >= 5;
        const maxReach = 100 - defBanked + (bonusReachable ? 20 : 0);
        if (maxReach < h.bid) return k;
    }
    // only settled at the final count (they could have made it but didn't)
    return tricks.length - 1;
};
