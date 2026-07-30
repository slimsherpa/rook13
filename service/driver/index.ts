// The driver: the only writer of server-side bot moves.
//
// Nudge-based, not listener-based, so Cloud Run can bill per-request
// instead of per-always-on-CPU (~$10/mo warm instance instead of ~$46/mo
// unthrottled): whenever a client sees that it's a SERVER_STYLES bot's
// turn it POSTs /nudge {gameId}; we reconstruct the truth from Firestore,
// ask the brain (FastAPI on localhost) for the decision, and commit it
// with the exact same optimistic-concurrency transaction the clients use.
// Clients keep a 20s local cover (useGame.ts), so a dead service degrades
// to local gen19 play instead of a hung table.
//
// The engine is THE app's engine — src/lib/game/engine.ts imported
// directly (tsx) — so doc-shape parity is structural, not maintained.

import http from 'node:http';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

import {
    GameDoc, GameAction, Seat, SEATS, SUITS, Card,
    isServerStyle,
} from '../../src/lib/game/types';
import { applyAction, isLaydown } from '../../src/lib/game/engine';

const BRAIN = process.env.BRAIN_URL ?? 'http://127.0.0.1:8081';
const PORT = Number(process.env.PORT ?? 8080);
// natural table pacing: never answer faster than this after the turn starts
const MIN_MOVE_MS = 1200;

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

// ---------------------------------------------------------------------------
// TS <-> brain encoding (ints 0..39, suit index * 10 + number - 5)
// ---------------------------------------------------------------------------
const cardToInt = (c: Card): number => SUITS.indexOf(c.suit) * 10 + (c.number - 5);
const intToCard = (i: number): Card => ({ suit: SUITS[Math.floor(i / 10)], number: (i % 10) + 5 });

// startup self-check: the shared encoding is a hard contract with the brain
if (cardToInt({ suit: 'Red', number: 5 }) !== 0
    || cardToInt({ suit: 'Green', number: 14 }) !== 39
    || intToCard(27).suit !== 'Black' || intToCard(27).number !== 12) {
    throw new Error('card int encoding fixture mismatch — driver/brain contract broken');
}

/** A logged production action, translated into the brain's vocabulary. */
const toBrainAction = (a: GameAction): Record<string, unknown> | null => {
    switch (a.type) {
        case 'DEAL':
        case 'ACK_REDEAL':
            return { type: a.type, deck: a.deck.map(cardToInt) };
        case 'BID':
            return { type: 'BID', seat: a.seat, bid: a.bid };
        case 'SELECT_GODOWN':
            return { type: 'SELECT_GODOWN', seat: a.seat, cards: a.cards.map(cardToInt) };
        case 'SELECT_TRUMP':
            return { type: 'SELECT_TRUMP', seat: a.seat, suit: SUITS.indexOf(a.suit) };
        case 'PLAY_CARD':
            return { type: 'PLAY_CARD', seat: a.seat, card: cardToInt(a.card) };
        case 'LAYDOWN':
            return { type: 'LAYDOWN', seat: a.seat };
        case 'NEXT_HAND':
            return { type: 'NEXT_HAND' };
        default:
            return null; // lobby / UI actions: replay no-ops
    }
};

const fromBrainAction = (a: any): GameAction => {
    switch (a.type) {
        case 'BID':
            return { type: 'BID', seat: a.seat, bid: a.bid };
        case 'SELECT_GODOWN':
            return { type: 'SELECT_GODOWN', seat: a.seat, cards: a.cards.map(intToCard) };
        case 'SELECT_TRUMP':
            return { type: 'SELECT_TRUMP', seat: a.seat, suit: SUITS[a.suit] };
        case 'PLAY_CARD':
            return { type: 'PLAY_CARD', seat: a.seat, card: intToCard(a.card) };
        default:
            throw new Error(`brain returned unknown action type: ${a.type}`);
    }
};

/** First dealer of the game — same id-hash rule as engine.ts START_GAME. */
const firstDealer = (id: string): Seat => {
    const hash = Array.from(id).reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
    return SEATS[hash % 4];
};

const THINKING_PHASES = new Set(['bidding', 'widow', 'trump', 'playing']);

// one decision in flight per game; keyed by the actionCount it answers
const inflight = new Map<string, number>();
let decisions = 0;
let covered = 0;

const maybeAct = async (gameId: string): Promise<string> => {
    const ref = db.collection('games').doc(gameId);
    const snap = await ref.get();
    if (!snap.exists) return 'no such game';
    const game = snap.data() as GameDoc;

    if (game.status !== 'active' || !game.turn) return 'not active / no turn';
    const seat = game.turn;
    const info = game.seats[seat];
    if (info.kind !== 'bot' || !isServerStyle(info.botStyle)) return 'not a server bot turn';
    if (!THINKING_PHASES.has(game.phase)) return 'not a thinking phase';

    const expected = game.actionCount;
    if (inflight.get(gameId) === expected) return 'already thinking';
    inflight.set(gameId, expected);
    const started = Date.now();

    try {
        let action: GameAction;
        if (game.phase === 'playing' && isLaydown(game, seat)) {
            // same theater as the client bots: claim it, don't grind it out
            action = { type: 'LAYDOWN', seat };
        } else {
            const log = await ref.collection('actions').orderBy('index').get();
            const actions = log.docs
                .map((d) => toBrainAction((d.data() as { action: GameAction }).action))
                .filter(Boolean);
            const res = await fetch(`${BRAIN}/decide`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    dealer: firstDealer(game.id),
                    actions,
                    style: info.botStyle,
                }),
            });
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                throw new Error(`brain ${res.status}: ${body.slice(0, 200)}`);
            }
            action = fromBrainAction((await res.json()).action);
        }

        // pace like a player, not a computer
        const wait = MIN_MOVE_MS - (Date.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));

        await db.runTransaction(async (tx) => {
            const cur = await tx.get(ref);
            const g = cur.data() as GameDoc;
            if (g.actionCount !== expected) {
                covered += 1;
                throw new Error('stale: a client got there first');
            }
            const next = applyAction(g, action);
            tx.set(ref, next);
            tx.set(ref.collection('actions').doc(String(next.actionCount).padStart(6, '0')), {
                index: next.actionCount,
                at: FieldValue.serverTimestamp(),
                action,
                by: 'bot',
            });
        });
        decisions += 1;
        console.log(`✓ ${gameId} #${expected} ${info.botStyle} ${seat} ${action.type} (${Date.now() - started}ms)`);
        return 'acted';
    } catch (e: any) {
        const msg = e?.message ?? String(e);
        console.warn(`✗ ${gameId} #${expected}: ${msg}`);
        return `error: ${msg}`;
    } finally {
        if (inflight.get(gameId) === expected) inflight.delete(gameId);
    }
};

// ---------------------------------------------------------------------------
// Blunder audits: solve the hand in hindsight, store the verdict once.
// games/{id}/audits/{hand} is written by THIS service only (rules deny
// client writes) so one hand is only ever solved once, no matter how many
// phones ask.
// ---------------------------------------------------------------------------
const auditInflight = new Set<string>();
// audits run ONE at a time per instance — a queue of 50s solver jobs must
// never crowd live game decisions out of the brain
let auditQueue: Promise<unknown> = Promise.resolve();
const runAuditQueued = (gameId: string, hand: number): Promise<Record<string, unknown>> => {
    const next = auditQueue.catch(() => { /* prior failure is its own report */ })
        .then(() => runAudit(gameId, hand));
    auditQueue = next;
    return next;
};

const runAudit = async (gameId: string, hand: number): Promise<Record<string, unknown>> => {
    const ref = db.collection('games').doc(gameId);
    const auditRef = ref.collection('audits').doc(String(hand));
    const existing = await auditRef.get();
    if (existing.exists) return existing.data()!;

    const key = `${gameId}:${hand}`;
    if (auditInflight.has(key)) return { status: 'busy' };
    auditInflight.add(key);
    try {
        const snap = await ref.get();
        if (!snap.exists) throw new Error('no such game');
        const game = snap.data() as GameDoc;
        if (hand < 1 || hand > game.handHistory.length) throw new Error('hand not finished');

        const log = await ref.collection('actions').orderBy('index').get();
        const actions = log.docs
            .map((d) => toBrainAction((d.data() as { action: GameAction }).action))
            .filter(Boolean);
        const res = await fetch(`${BRAIN}/audit`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ dealer: firstDealer(game.id), actions, hand }),
        });
        if (!res.ok) throw new Error(`brain ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const verdict = await res.json();
        const doc = {
            hand,
            blunders: (verdict.blunders as any[]).map((b) => ({
                trick: b.trick,
                seat: b.seat,
                card: intToCard(b.card),
                better: intToCard(b.better),
                delta: b.delta,
            })),
            analyzed: verdict.analyzed,
            skipped: verdict.skipped,
            engine: 'godrook-solver-v1',
            at: Date.now(),
        };
        await auditRef.set(doc);
        console.log(`🔍 audit ${gameId} hand ${hand}: ${doc.blunders.length} blunders (${verdict.analyzed} solved, ${verdict.skipped} skipped)`);
        return doc;
    } finally {
        auditInflight.delete(key);
    }
};

// ---------------------------------------------------------------------------
// HTTP surface: POST /nudge {gameId}, POST /audit {gameId, hand}, GET /status
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    // browsers preflight the JSON nudge — without these headers every
    // client fetch dies at OPTIONS and the tables fall back to local cover
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') {
        res.writeHead(204).end();
        return;
    }
    // NB: /healthz is intercepted by Google's frontend on run.app (stock 404
    // before the container) — hence /status
    if (req.method === 'GET' && (url.pathname === '/status' || url.pathname === '/healthz')) {
        let brain: unknown = 'unreachable';
        try {
            brain = await (await fetch(`${BRAIN}/healthz`)).json();
        } catch { /* brain still booting */ }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, decisions, covered, brain }));
        return;
    }
    if (req.method === 'POST' && (url.pathname === '/nudge' || url.pathname === '/audit')) {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', async () => {
            try {
                const { gameId, hand } = JSON.parse(body || '{}');
                if (typeof gameId !== 'string' || !/^[a-z0-9]{1,32}$/.test(gameId)) {
                    res.writeHead(400).end('bad gameId');
                    return;
                }
                // answer after the work so Cloud Run keeps CPU allocated
                // for the whole think (request-based billing)
                const payload = url.pathname === '/nudge'
                    ? { outcome: await maybeAct(gameId) }
                    : await runAuditQueued(gameId, Number(hand));
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify(payload));
            } catch (e: any) {
                res.writeHead(500).end(e?.message ?? 'error');
            }
        });
        return;
    }
    res.writeHead(404).end();
});

server.listen(PORT, () => console.log(`driver listening on :${PORT}, brain at ${BRAIN}`));
