// Endgame bid guard: provable auction discipline near victory (the
// cousins' 495-point report). Simulation evidence lives in the ml lab
// (guardsim: +2.0 to +4.5 win-rate in every fire state, never negative);
// this suite pins the TS rule's boundaries.
import { describe, it, expect } from 'vitest';
import { createGameDoc, applyAction } from '../game/engine';
import { GameDoc, Seat, nextSeat } from '../game/types';
import { endgameGuardBid, GUARD_MY_SCORE, GUARD_OPP_SCORE } from './agent';

const biddingGame = (scoreA: number, scoreB: number): GameDoc => {
    let g = createGameDoc({ id: 'guard', joinCode: 'GRD', host: { uid: 'h', name: 'Host' }, now: 1 });
    g = applyAction(g, { type: 'START_GAME' });
    // bidding opens left of the dealer
    g = { ...g, scores: { A: scoreA, B: scoreB }, phase: 'bidding', turn: nextSeat(g.dealer!) };
    return g;
};

describe('endgame bid guard', () => {
    it('passes when victory is in reach and opponents cannot finish', () => {
        const g = biddingGame(495, 300);
        // the guarded seat: any A-team seat; pick one that is not forced
        const seat = (['A1', 'A2'] as Seat[]).find((s) => s !== g.dealer) ?? 'A1';
        const a = endgameGuardBid(g, seat);
        expect(a).toEqual({ type: 'BID', seat, bid: 'pass' });
    });

    it('stays out of it below the score threshold', () => {
        expect(endgameGuardBid(biddingGame(GUARD_MY_SCORE - 5, 300), 'A1')).toBeNull();
    });

    it('stays out of it when opponents could cross 500 this hand', () => {
        expect(endgameGuardBid(biddingGame(495, GUARD_OPP_SCORE + 5), 'A1')).toBeNull();
    });

    it('never applies to the trailing team', () => {
        expect(endgameGuardBid(biddingGame(300, 495), 'A1')).toBeNull();
    });

    it('bids the minimum when the must-bid rule forces the dealer', () => {
        let g = biddingGame(495, 300);
        // everyone else passes; the dealer is forced
        let turn = g.turn as Seat;
        for (let i = 0; i < 3; i++) {
            g = applyAction(g, { type: 'BID', seat: turn, bid: 'pass' });
            turn = g.turn as Seat;
        }
        expect(turn).toBe(g.dealer);
        if (turn === 'A1' || turn === 'A2') {
            const a = endgameGuardBid(g, turn);
            expect(a).toEqual({ type: 'BID', seat: turn, bid: 65 });
        }
    });

    it('does nothing outside the bidding phase', () => {
        const g = { ...biddingGame(495, 300), phase: 'playing' as const };
        expect(endgameGuardBid(g, 'A1')).toBeNull();
    });
});
