// Fast hand playout for search and training. materialize() fuses an
// Observation with a sampled World into a playable state; playOut() drives it
// to the end of the hand with the heuristic bots and scores it — mutating a
// cheap local copy instead of paying the real engine's clone-per-action cost.
// rollout.test.ts proves this scores identically to the real engine.

import {
    GameDoc, Card, Seat, Team, SEATS, VALID_BIDS, TAKING_TRICKS_BONUS, TRICKS_PER_HAND,
    getCardPoints, teamOf, nextSeat, sameCard,
} from '../game/types';
import { winningCardSeat, bidLead } from '../game/engine';
import { nextBotAction } from '../game/bots';
import { Observation } from './observation';
import { World } from './determinize';

/** Full playable state from what we know + one guess about what we don't. */
export const materialize = (o: Observation, w: World): GameDoc => ({
    id: 'rollout',
    joinCode: '----',
    hostUid: 'rollout',
    createdAt: 0,
    updatedAt: 0,
    status: 'active',
    seats: {
        A1: { kind: 'bot', name: 'A1', botStyle: 'basic' },
        B1: { kind: 'bot', name: 'B1', botStyle: 'basic' },
        A2: { kind: 'bot', name: 'A2', botStyle: 'basic' },
        B2: { kind: 'bot', name: 'B2', botStyle: 'basic' },
    },
    playerUids: [],
    phase: 'playing',
    actionCount: 0,
    handNumber: o.handNumber,
    dealer: o.dealer,
    turn: o.turn,
    hands: {
        A1: [...w.hands.A1], B1: [...w.hands.B1],
        A2: [...w.hands.A2], B2: [...w.hands.B2],
    },
    widow: [],
    goDown: w.goDown,
    bids: { ...o.bids },
    highBid: o.highBid,
    bidWinner: o.bidWinner,
    trump: o.trump,
    trickPlays: [...o.trickPlays],
    trickLeader: o.trickLeader,
    completedTricks: [...o.completedTricks],
    tricksWon: { ...o.tricksWon },
    pointsTaken: { ...o.pointsTaken },
    scores: { ...o.scores },
    handHistory: [],
    redealSeat: null,
    redealCount: 0,
    winner: null,
});

/**
 * Full playable state from a mid-auction observation + one guessed world.
 * The world's hidden 4-card bucket is the face-down widow here.
 */
export const materializeAuction = (o: Observation, w: World): GameDoc => {
    const g = materialize(o, w);
    g.phase = 'bidding';
    g.widow = w.goDown;
    g.goDown = [];
    g.bidWinner = null;
    g.trump = null;
    g.trickLeader = null;
    return g;
};

/** Apply one bid, mutating `g`. Mirrors the engine's BID transition exactly. */
export const applyBidFast = (g: GameDoc, seat: Seat, bid: number | 'pass'): void => {
    g.bids[seat] = bid;
    if (bid !== 'pass') g.highBid = bid;

    const passed = (s: Seat) => g.bids[s] === 'pass';
    const passes = SEATS.filter(passed).length;
    const maxedOut = g.highBid === VALID_BIDS[VALID_BIDS.length - 1];

    if ((passes === 3 && g.highBid !== null) || maxedOut) {
        const winner = maxedOut ? seat : SEATS.find((s) => !passed(s))!;
        g.bidWinner = winner;
        g.phase = 'widow';
        g.turn = winner;
        g.hands[winner] = [...g.hands[winner], ...g.widow];
        g.widow = [];
        return;
    }
    let t = nextSeat(seat);
    while (passed(t)) t = nextSeat(t);
    g.turn = t;
};

/** Apply one card play, mutating `g`. Resolves the trick on the 4th card. */
export const applyPlayFast = (g: GameDoc, seat: Seat, card: Card): void => {
    const hand = g.hands[seat];
    const idx = hand.findIndex((c) => sameCard(c, card));
    if (idx < 0) throw new Error(`rollout: ${seat} does not hold ${card.suit} ${card.number}`);
    hand.splice(idx, 1);
    g.trickPlays.push({ seat, card });

    if (g.trickPlays.length < 4) {
        g.turn = nextSeat(seat);
        return;
    }
    const winner = winningCardSeat(g.trickPlays, g.trump);
    const points = g.trickPlays.reduce((s, p) => s + getCardPoints(p.card), 0);
    g.completedTricks.push({
        leader: g.trickLeader!, plays: g.trickPlays, winner, points,
    });
    const team = teamOf(winner);
    g.tricksWon[team] += 1;
    g.pointsTaken[team] += points;
    g.trickPlays = [];
    g.trickLeader = winner;
    g.turn = winner;

    if (g.completedTricks.length === TRICKS_PER_HAND) {
        // last trick claims the go-down; 5+ tricks earns the bonus
        g.pointsTaken[team] += g.goDown.reduce((s, c) => s + getCardPoints(c), 0);
        for (const t of ['A', 'B'] as Team[]) {
            if (g.tricksWon[t] >= 5) g.pointsTaken[t] += TAKING_TRICKS_BONUS;
        }
        g.turn = null;
    }
};

/** Hand score for each team, with the bid team going set below its bid. */
export const scoreHand = (g: GameDoc): Record<Team, number> => {
    const bidTeam = teamOf(g.bidWinner!);
    const other: Team = bidTeam === 'A' ? 'B' : 'A';
    if (g.pointsTaken[bidTeam] >= (g.highBid ?? 0)) {
        return { [bidTeam]: g.pointsTaken[bidTeam], [other]: g.pointsTaken[other] } as Record<Team, number>;
    }
    return { [bidTeam]: -(g.highBid ?? 0), [other]: g.pointsTaken[other] } as Record<Team, number>;
};

/** Play the hand to completion with the heuristic bots; mutates `g`. */
export const playOut = (g: GameDoc): void => {
    let safety = 40;
    while (g.completedTricks.length < TRICKS_PER_HAND && safety-- > 0) {
        const action = nextBotAction(g);
        if (!action || action.type !== 'PLAY_CARD') {
            throw new Error(`rollout wedged: ${action?.type ?? 'null'} in trick ${g.completedTricks.length + 1}`);
        }
        applyPlayFast(g, action.seat, action.card);
    }
    if (safety <= 0) throw new Error('rollout did not terminate');
};

/**
 * Drive a hand to completion from anywhere in the auction onward, using the
 * heuristic bots for every remaining decision; mutates `g`. Mirrors the
 * engine's bidding/widow/trump transitions (validated in alpharook.test.ts).
 */
export const playOutHand = (g: GameDoc): void => {
    let safety = 60;
    while (g.phase !== 'playing' && safety-- > 0) {
        const action = nextBotAction(g);
        if (!action) throw new Error(`auction rollout wedged in ${g.phase}`);
        switch (action.type) {
            case 'BID':
                applyBidFast(g, action.seat, action.bid);
                break;
            case 'SELECT_GODOWN':
                g.goDown = action.cards;
                g.hands[action.seat] = g.hands[action.seat].filter(
                    (c) => !action.cards.some((sel) => sameCard(sel, c)),
                );
                g.phase = 'trump';
                break;
            case 'SELECT_TRUMP':
                g.trump = action.suit;
                g.phase = 'playing';
                g.trickLeader = bidLead(g.dealer!);
                g.turn = g.trickLeader;
                g.trickPlays = [];
                break;
            default:
                throw new Error(`auction rollout: unexpected ${action.type}`);
        }
    }
    if (safety <= 0) throw new Error('auction rollout did not terminate');
    playOut(g);
};

/** This team's score minus the opponents' — the value PIMC maximizes. */
export const valueFor = (g: GameDoc, team: Team): number => {
    const s = scoreHand(g);
    return s[team] - s[team === 'A' ? 'B' : 'A'];
};
