// Golden-trace generator for the Python engine port (ml/rook).
//
// Plays complete games (-250..500) with the REAL engine and the deterministic
// heuristic bots, and dumps every action plus a state snapshot after each one
// to ml/tests/fixtures/traces.json. The Python port must reproduce every
// transition AND every bot decision exactly — that's the parity contract that
// lets AlphaRook train against a native-Python engine without rules drift.
//
// Regenerate with:  GEN_TRACES=1 npx vitest run src/lib/alpharook/traces.gen.test.ts
// (Guarded by env var so `npm test` doesn't rewrite fixtures on every run.)

import { describe, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { GameDoc, GameAction, Card, Seat, SEATS, BotStyle } from '../game/types';
import { createGameDoc, applyAction } from '../game/engine';
import { createDeck, shuffle } from '../game/deck';
import { nextBotAction } from '../game/bots';

// mulberry32 — tiny seeded PRNG, reproducible across runs.
const mulberry32 = (a: number) => () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Compact card encoding shared with Python: suitIndex*10 + (number-5), 0..39.
const SUIT_IDX: Record<string, number> = { Red: 0, Yellow: 1, Black: 2, Green: 3 };
const enc = (c: Card): number => SUIT_IDX[c.suit] * 10 + (c.number - 5);

const encAction = (a: GameAction): Record<string, unknown> => {
    switch (a.type) {
        case 'DEAL': return { t: 'DEAL', deck: a.deck.map(enc) };
        case 'ACK_REDEAL': return { t: 'ACK_REDEAL', deck: a.deck.map(enc) };
        case 'BID': return { t: 'BID', seat: a.seat, bid: a.bid };
        case 'SELECT_GODOWN': return { t: 'GODOWN', seat: a.seat, cards: a.cards.map(enc) };
        case 'SELECT_TRUMP': return { t: 'TRUMP', seat: a.seat, suit: SUIT_IDX[a.suit] };
        case 'PLAY_CARD': return { t: 'PLAY', seat: a.seat, card: enc(a.card) };
        case 'NEXT_HAND': return { t: 'NEXT' };
        default: throw new Error(`unexpected action ${a.type}`);
    }
};

const snapshot = (g: GameDoc) => ({
    p: g.phase,
    t: g.turn,
    sA: g.scores.A, sB: g.scores.B,
    pA: g.pointsTaken.A, pB: g.pointsTaken.B,
    twA: g.tricksWon.A, twB: g.tricksWon.B,
    hb: g.highBid, bw: g.bidWinner,
    tr: g.trump ? SUIT_IDX[g.trump] : null,
});

// Deterministic styles only ('random' rolls dice we can't replay).
const LINEUPS: BotStyle[][] = [
    ['basic', 'basic', 'basic', 'basic'],
    ['basic', 'aggressive', 'basic', 'cautious'],
    ['aggressive', 'cautious', 'aggressive', 'cautious'],
    ['cautious', 'basic', 'aggressive', 'basic'],
];

describe('trace generation', () => {
    it.skipIf(!process.env.GEN_TRACES)('dumps golden games for the Python port', () => {
        const games: unknown[] = [];
        const N_GAMES = 24;
        for (let i = 0; i < N_GAMES; i++) {
            const rng = mulberry32(1000 + i * 7919);
            const styles = LINEUPS[i % LINEUPS.length];

            let g = createGameDoc({
                id: `trace-${i}`, joinCode: '0000',
                host: { uid: 'trace', name: 'trace' }, now: 0,
            });
            SEATS.forEach((s, si) => {
                g.seats[s] = { kind: 'bot', name: s, botStyle: styles[si] };
            });
            g.status = 'active';
            g.phase = 'dealing';
            g.handNumber = 1;
            g.dealer = SEATS[Math.floor(rng() * 4)];
            g.turn = g.dealer;

            const actions: unknown[] = [];
            const snaps: unknown[] = [];
            let safety = 20000;
            while (g.phase !== 'game_over' && safety-- > 0) {
                let action: GameAction;
                if (g.phase === 'dealing') {
                    action = { type: 'DEAL', deck: shuffle(createDeck(), rng) };
                } else if (g.phase === 'redeal') {
                    action = { type: 'ACK_REDEAL', deck: shuffle(createDeck(), rng) };
                } else if (g.phase === 'hand_done') {
                    action = { type: 'NEXT_HAND' };
                } else {
                    const a = nextBotAction(g);
                    if (!a) throw new Error(`no bot action in ${g.phase}`);
                    action = a;
                }
                g = applyAction(g, action, 0);
                actions.push(encAction(action));
                snaps.push(snapshot(g));
            }
            if (safety <= 0) throw new Error('game did not terminate');

            games.push({
                seed: 1000 + i * 7919,
                styles,
                dealer: SEATS[Math.floor(mulberry32(1000 + i * 7919)() * 4)],
                actions,
                snaps,
                final: {
                    scores: { A: g.scores.A, B: g.scores.B },
                    winner: g.winner,
                    hands: g.handHistory.length,
                },
            });
        }

        const outPath = path.resolve(__dirname, '../../../ml/tests/fixtures/traces.json');
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, JSON.stringify({ version: 1, games }));
        // eslint-disable-next-line no-console
        console.log(`wrote ${games.length} games to ${outPath}`);
    });
});
