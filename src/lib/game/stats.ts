// Lifetime-stat bookkeeping, pure and unit-testable. userService feeds
// HandSummary entries through applyHandStats as hands finish (so the Trophy
// Case updates mid-game, not just at the final whistle) and caps a game off
// with applyGameFinalStats. The same rainbow rule feeds the recap's live
// "trophy moments", so the celebration and the trophy can never disagree.

import { GameDoc, HandSummary, Seat, Team, getCardPoints, teamOf } from './types';

export interface UserStats {
    gamesPlayed: number;
    gamesWon: number;
    handsPlayed: number;
    bidsWon: number;
    bidsMade: number;   // bids won that weren't set — the "made its"
    timesSet: number;
    redealsWitnessed: number;
    highestBidMade: number;
    // Trophy-case extras. Older profiles simply lack them (merged over
    // emptyStats() on every update), and hand-deal stats only accrue from
    // games recorded after HandSummary started carrying dealtHands.
    highestBid: number;                    // highest auction won, made or set
    setsDefended: number;                  // opposing bidder went set on your watch
    maxHandPoints: number;                 // most count dealt in one hand (4 tens + a 5 = 45!)
    zeroCountHands: number;                // dealt a hand with zero count
    longestSuit: number;                   // most cards of one suit in a deal
    rainbowCounts: Record<string, number>; // '14' -> times you held all four 14s
    madeByBid: Record<string, number>;     // '100' -> times you bid 100 and made it
    sweeps: number;                        // hands where your team took all 9 tricks
    pointsCaptured: number;                // lifetime card points your team banked
    widestWinMargin: number;               // biggest final-score gap in a game you won
}

export const emptyStats = (): UserStats => ({
    gamesPlayed: 0,
    gamesWon: 0,
    handsPlayed: 0,
    bidsWon: 0,
    bidsMade: 0,
    timesSet: 0,
    redealsWitnessed: 0,
    highestBidMade: 0,
    highestBid: 0,
    setsDefended: 0,
    maxHandPoints: 0,
    zeroCountHands: 0,
    longestSuit: 0,
    rainbowCounts: {},
    madeByBid: {},
    sweeps: 0,
    pointsCaptured: 0,
    widestWinMargin: 0,
});

/**
 * Numbers this seat held all four of during the hand. The bid winner's
 * rainbow counts the widow pickup too — if the fourth 14 arrived in the
 * widow, you still held all four 14s at the table, and that's a rainbow.
 */
export const rainbowNumbersFor = (h: HandSummary, seat: Seat): number[] => {
    const dealt = h.dealtHands?.[seat];
    if (!dealt || dealt.length === 0) return [];
    const held = seat === h.bidWinner && h.dealtWidow ? [...dealt, ...h.dealtWidow] : dealt;
    const byNumber = new Map<number, number>();
    for (const c of held) byNumber.set(c.number, (byNumber.get(c.number) ?? 0) + 1);
    return Array.from(byNumber.entries())
        .filter(([, n]) => n === 4)
        .map(([num]) => num)
        .sort((a, b) => a - b);
};

/** Fold one finished hand into `stats` (mutates and returns it). */
export const applyHandStats = (stats: UserStats, h: HandSummary, seat: Seat): UserStats => {
    const myTeam = teamOf(seat);

    stats.handsPlayed += 1;
    stats.pointsCaptured += h.pointsTaken[myTeam];
    if (h.tricksWon[myTeam] === 9) stats.sweeps += 1;
    if (teamOf(h.bidWinner) !== myTeam && h.wentSet) stats.setsDefended += 1;

    if (h.bidWinner === seat) {
        stats.bidsWon += 1;
        stats.highestBid = Math.max(stats.highestBid, h.bid);
        if (h.wentSet) {
            stats.timesSet += 1;
        } else {
            stats.bidsMade += 1;
            stats.highestBidMade = Math.max(stats.highestBidMade, h.bid);
            const k = String(h.bid);
            stats.madeByBid[k] = (stats.madeByBid[k] ?? 0) + 1;
        }
    }

    const dealt = h.dealtHands?.[seat];
    if (dealt && dealt.length > 0) {
        const pts = dealt.reduce((sum, c) => sum + getCardPoints(c), 0);
        stats.maxHandPoints = Math.max(stats.maxHandPoints, pts);
        if (pts === 0) stats.zeroCountHands += 1;
        const bySuit = new Map<string, number>();
        for (const c of dealt) bySuit.set(c.suit, (bySuit.get(c.suit) ?? 0) + 1);
        stats.longestSuit = Math.max(stats.longestSuit, ...Array.from(bySuit.values()));
        for (const num of rainbowNumbersFor(h, seat)) {
            const k = String(num);
            stats.rainbowCounts[k] = (stats.rainbowCounts[k] ?? 0) + 1;
        }
    }

    return stats;
};

/** Fold the game-level facts in once, when the game completes. */
export const applyGameFinalStats = (stats: UserStats, game: GameDoc, seat: Seat): UserStats => {
    const won: boolean = (teamOf(seat) as Team) === game.winner;
    stats.gamesPlayed += 1;
    if (won) {
        stats.gamesWon += 1;
        const myTeam = teamOf(seat) as Team;
        const other: Team = myTeam === 'A' ? 'B' : 'A';
        const margin = game.scores[myTeam] - game.scores[other];
        stats.widestWinMargin = Math.max(stats.widestWinMargin ?? 0, margin);
    }
    stats.redealsWitnessed += game.redealCount;
    return stats;
};
