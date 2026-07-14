// The Rook13 rules engine.
//
// Pure, deterministic, JSON-in/JSON-out. Every game mutation is a GameAction
// applied via applyAction(). Randomness (shuffles, dealer choice) always
// arrives inside the action payload, so a game can be perfectly reconstructed
// by replaying its action log.

import {
    GameDoc, GameAction, Card, Seat, Suit, Team, SeatInfo, HandSummary,
    SEATS, SUITS, VALID_BIDS, TRICKS_PER_HAND, WIN_SCORE, LOSE_SCORE, TAKING_TRICKS_BONUS,
    DEFAULT_BOT_STYLE, getCardPoints, teamOf, nextSeat, sameCard,
} from './types';
import { splitDeal, isRedealHand, isValidDeck, sortHand } from './deck';

export class InvalidActionError extends Error {}

const DEFAULT_BOT_NAMES: Record<Seat, string> = {
    A1: 'Rookie',
    B1: 'Lefty',
    A2: 'Birdie',
    B2: 'Righty',
};

const emptySeat = (): SeatInfo => ({ kind: 'open', name: 'Open Seat' });

const emptyHands = (): Record<Seat, Card[]> => ({ A1: [], B1: [], A2: [], B2: [] });

export const createGameDoc = (params: {
    id: string;
    joinCode: string;
    host: { uid: string; name: string; photoURL?: string };
    hostSeat?: Seat;
    now?: number;
}): GameDoc => {
    const now = params.now ?? Date.now();
    const seats: Record<Seat, SeatInfo> = {
        A1: emptySeat(), B1: emptySeat(), A2: emptySeat(), B2: emptySeat(),
    };
    const hostSeat = params.hostSeat ?? 'A1';
    seats[hostSeat] = {
        kind: 'human',
        uid: params.host.uid,
        name: params.host.name,
        ...(params.host.photoURL ? { photoURL: params.host.photoURL } : {}),
    };
    return {
        id: params.id,
        joinCode: params.joinCode,
        hostUid: params.host.uid,
        createdAt: now,
        updatedAt: now,
        status: 'lobby',
        seats,
        playerUids: [params.host.uid],
        phase: 'lobby',
        actionCount: 0,
        handNumber: 0,
        dealer: null,
        turn: null,
        hands: emptyHands(),
        widow: [],
        goDown: [],
        bids: {},
        highBid: null,
        bidWinner: null,
        trump: null,
        trickPlays: [],
        trickLeader: null,
        completedTricks: [],
        tricksWon: { A: 0, B: 0 },
        pointsTaken: { A: 0, B: 0 },
        scores: { A: 0, B: 0 },
        handHistory: [],
        redealSeat: null,
        redealCount: 0,
        winner: null,
    };
};

// ---------------------------------------------------------------------------
// Queries (used by both the engine and the UI)
// ---------------------------------------------------------------------------

export const leadSuit = (g: GameDoc): Suit | null =>
    g.trickPlays.length > 0 ? g.trickPlays[0].card.suit : null;

/** Cards `seat` may legally play right now. */
export const legalCards = (g: GameDoc, seat: Seat): Card[] => {
    if (g.phase !== 'playing' || g.turn !== seat) return [];
    const hand = g.hands[seat];
    const lead = leadSuit(g);
    if (!lead) return hand;
    const followers = hand.filter((c) => c.suit === lead);
    return followers.length > 0 ? followers : hand;
};

/** The lowest bid `seat` could make right now (null = can only pass). */
export const minNextBid = (g: GameDoc): number | null => {
    const floor = g.highBid === null ? VALID_BIDS[0] : g.highBid + 5;
    return floor > VALID_BIDS[VALID_BIDS.length - 1] ? null : floor;
};

/** True when the current bidder is forced to bid (first three all passed). */
export const mustBid = (g: GameDoc): boolean => {
    if (g.phase !== 'bidding') return false;
    const passes = Object.values(g.bids).filter((b) => b === 'pass').length;
    return passes === 3 && g.highBid === null;
};

export const winningCardSeat = (
    plays: { seat: Seat; card: Card }[],
    trump: Suit | null,
): Seat => {
    const lead = plays[0].card.suit;
    let best = plays[0];
    for (const p of plays.slice(1)) {
        const bestIsTrump = trump !== null && best.card.suit === trump;
        const pIsTrump = trump !== null && p.card.suit === trump;
        if (pIsTrump && !bestIsTrump) {
            best = p;
        } else if (pIsTrump === bestIsTrump && p.card.suit === best.card.suit && p.card.number > best.card.number) {
            best = p;
        } else if (!pIsTrump && !bestIsTrump && best.card.suit !== lead && p.card.suit === lead) {
            best = p; // shouldn't happen (leader defines lead), kept for safety
        }
    }
    return best.seat;
};

const trickPoints = (plays: { seat: Seat; card: Card }[]): number =>
    plays.reduce((sum, p) => sum + getCardPoints(p.card), 0);

export const goDownPoints = (g: GameDoc): number =>
    g.goDown.reduce((sum, c) => sum + getCardPoints(c), 0);

/** Seat that leads the first trick of the hand: left of the dealer. */
export const bidLead = (dealer: Seat): Seat => nextSeat(dealer);

/**
 * True when every card left in `seat`'s hand is a guaranteed winner — nothing
 * in ANY other hand (partner included) could ever beat one of them, in any
 * order of play. A non-trump card additionally requires that nobody else
 * holds trump at all, since a void could develop in some order of leads.
 * Only meaningful on lead: the player must be starting the trick.
 */
export const isLaydown = (g: GameDoc, seat: Seat): boolean => {
    if (g.phase !== 'playing' || g.turn !== seat || g.trickPlays.length > 0) return false;
    const hand = g.hands[seat];
    if (hand.length === 0) return false;
    const others = SEATS.filter((s) => s !== seat).flatMap((s) => g.hands[s]);
    return hand.every((c) => {
        if (c.suit === g.trump) {
            return !others.some((d) => d.suit === g.trump && d.number > c.number);
        }
        return !others.some((d) => d.suit === g.trump || (d.suit === c.suit && d.number > c.number));
    });
};

/**
 * The highest point total the bidding team can still reach this hand
 * (they win everything left: every remaining trick, the go-down, and the
 * 5-trick bonus if it's still reachable). null outside of trick play.
 *
 * Compare against the bid: `< bid` means they're set no matter what;
 * `=== bid` means they're maxxed — one more counter lost and they're set.
 */
export const bidTeamMaxPoints = (g: GameDoc): number | null => {
    if (g.phase !== 'playing' || !g.bidWinner || g.highBid === null) return null;
    const bidTeam = teamOf(g.bidWinner);
    const defTeam: Team = bidTeam === 'A' ? 'B' : 'A';
    // 100 card points in the deck; whatever the defenders have banked is gone.
    const tricksLeft = TRICKS_PER_HAND - g.completedTricks.length;
    const bonusReachable = g.tricksWon[bidTeam] + tricksLeft >= 5;
    return 100 - g.pointsTaken[defTeam] + (bonusReachable ? TAKING_TRICKS_BONUS : 0);
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Returns an error message, or null when the action is legal. */
export const validateAction = (g: GameDoc, action: GameAction): string | null => {
    switch (action.type) {
        case 'SIT': {
            if (g.status !== 'lobby') return 'Game already started';
            const target = g.seats[action.seat];
            if (target.kind === 'human') return 'Seat is taken';
            if (SEATS.some((s) => g.seats[s].kind === 'human' && g.seats[s].uid === action.player.uid && s !== action.seat)) {
                return null; // moving seats is allowed; handled in apply
            }
            return null;
        }
        case 'LEAVE_SEAT': {
            if (g.status !== 'lobby') return 'Game already started';
            const seat = g.seats[action.seat];
            if (seat.kind !== 'human' || seat.uid !== action.uid) return 'Not your seat';
            return null;
        }
        case 'SET_BOT': {
            if (g.status !== 'lobby') return 'Game already started';
            if (g.seats[action.seat].kind === 'human') return 'Seat is occupied by a player';
            return null;
        }
        case 'OPEN_SEAT': {
            if (g.status !== 'lobby') return 'Game already started';
            if (g.seats[action.seat].kind === 'human') return 'Seat is occupied by a player';
            return null;
        }
        case 'START_GAME': {
            if (g.status !== 'lobby') return 'Game already started';
            if (!SEATS.some((s) => g.seats[s].kind === 'human')) return 'Need at least one human player';
            return null;
        }
        case 'DEAL': {
            if (g.phase !== 'dealing') return 'Not in dealing phase';
            if (!isValidDeck(action.deck)) return 'Invalid deck';
            return null;
        }
        case 'ACK_REDEAL': {
            if (g.phase !== 'redeal') return 'No redeal pending';
            if (!isValidDeck(action.deck)) return 'Invalid deck';
            return null;
        }
        case 'BID': {
            if (g.phase !== 'bidding') return 'Not in bidding phase';
            if (g.turn !== action.seat) return 'Not your turn to bid';
            if (action.bid === 'pass') {
                if (mustBid(g)) return 'You must bid — everyone else passed';
                return null;
            }
            if (!VALID_BIDS.includes(action.bid)) return 'Invalid bid amount';
            if (g.highBid !== null && action.bid <= g.highBid) return 'Bid must be higher than the current bid';
            return null;
        }
        case 'SELECT_GODOWN': {
            if (g.phase !== 'widow') return 'Not selecting the go-down now';
            if (g.bidWinner !== action.seat) return 'Only the bid winner selects the go-down';
            if (action.cards.length !== 4) return 'Select exactly 4 cards';
            const hand = g.hands[action.seat];
            const keys = new Set(action.cards.map((c) => `${c.suit}-${c.number}`));
            if (keys.size !== 4) return 'Duplicate cards selected';
            for (const c of action.cards) {
                if (!hand.some((h) => sameCard(h, c))) return 'Selected card is not in your hand';
            }
            return null;
        }
        case 'SELECT_TRUMP': {
            if (g.phase !== 'trump') return 'Not selecting trump now';
            if (g.bidWinner !== action.seat) return 'Only the bid winner declares trump';
            return null;
        }
        case 'PLAY_CARD': {
            if (g.phase !== 'playing') return 'Not in playing phase';
            if (g.turn !== action.seat) return 'Not your turn';
            const hand = g.hands[action.seat];
            if (!hand.some((c) => sameCard(c, action.card))) return 'Card not in your hand';
            const legal = legalCards(g, action.seat);
            if (!legal.some((c) => sameCard(c, action.card))) return 'You must follow suit';
            return null;
        }
        case 'LAYDOWN': {
            if (g.phase !== 'playing') return 'Not in playing phase';
            if (g.turn !== action.seat) return 'Not your turn';
            if (g.trickPlays.length > 0) return 'You can only lay down when leading';
            if (!isLaydown(g, action.seat)) return 'Your cards are not all guaranteed winners';
            return null;
        }
        case 'NEXT_HAND': {
            if (g.phase !== 'hand_done') return 'Hand is not finished';
            return null;
        }
    }
};

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export const applyAction = (g: GameDoc, action: GameAction, now?: number): GameDoc => {
    const err = validateAction(g, action);
    if (err) throw new InvalidActionError(err);

    // work on a structural clone so callers can rely on immutability
    const next: GameDoc = JSON.parse(JSON.stringify(g));
    next.actionCount = g.actionCount + 1;
    next.updatedAt = now ?? Date.now();

    switch (action.type) {
        case 'SIT': {
            // vacate any seat the player already holds (seat switching in lobby)
            for (const s of SEATS) {
                if (next.seats[s].kind === 'human' && next.seats[s].uid === action.player.uid) {
                    next.seats[s] = emptySeat();
                }
            }
            next.seats[action.seat] = {
                kind: 'human',
                uid: action.player.uid,
                name: action.player.name,
                ...(action.player.photoURL ? { photoURL: action.player.photoURL } : {}),
            };
            next.playerUids = SEATS
                .map((s) => next.seats[s])
                .filter((si) => si.kind === 'human' && si.uid)
                .map((si) => si.uid!) ;
            return next;
        }
        case 'LEAVE_SEAT': {
            next.seats[action.seat] = emptySeat();
            next.playerUids = SEATS
                .map((s) => next.seats[s])
                .filter((si) => si.kind === 'human' && si.uid)
                .map((si) => si.uid!);
            return next;
        }
        case 'SET_BOT': {
            next.seats[action.seat] = {
                kind: 'bot',
                name: action.name || DEFAULT_BOT_NAMES[action.seat],
                botStyle: action.botStyle,
            };
            return next;
        }
        case 'OPEN_SEAT': {
            next.seats[action.seat] = emptySeat();
            return next;
        }
        case 'START_GAME': {
            for (const s of SEATS) {
                if (next.seats[s].kind === 'open') {
                    next.seats[s] = { kind: 'bot', name: DEFAULT_BOT_NAMES[s], botStyle: DEFAULT_BOT_STYLE };
                }
            }
            next.status = 'active';
            next.phase = 'dealing';
            next.handNumber = 1;
            // Deterministic-but-fair first dealer: derived from the game id so
            // replays reproduce it without a random payload.
            const hash = Array.from(next.id).reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
            next.dealer = SEATS[hash % 4];
            next.turn = next.dealer;
            return next;
        }
        case 'DEAL':
        case 'ACK_REDEAL': {
            const { hands, widow } = splitDeal(action.deck);
            const offender = SEATS.find((s) => isRedealHand(hands[s]));
            next.hands = hands;
            next.widow = widow;
            if (offender) {
                // The legendary all-6-7-8-9 hand. Pause and celebrate before redealing.
                next.phase = 'redeal';
                next.redealSeat = offender;
                next.redealCount = g.redealCount + 1;
                next.turn = next.dealer;
                return next;
            }
            next.redealSeat = null;
            // remember the deal itself — the recap shows what everyone was
            // dealt long after the widow pickup has reshuffled the hands
            next.dealtHands = JSON.parse(JSON.stringify(hands));
            next.dealtWidow = JSON.parse(JSON.stringify(widow));
            next.phase = 'bidding';
            next.turn = bidLead(next.dealer!);
            next.bids = {};
            next.bidLog = [];
            next.highBid = null;
            next.bidWinner = null;
            next.trump = null;
            next.goDown = [];
            next.trickPlays = [];
            next.trickLeader = null;
            next.completedTricks = [];
            next.tricksWon = { A: 0, B: 0 };
            next.pointsTaken = { A: 0, B: 0 };
            return next;
        }
        case 'BID': {
            next.bids[action.seat] = action.bid;
            next.bidLog = [...(next.bidLog ?? []), { seat: action.seat, bid: action.bid }];
            if (action.bid !== 'pass') next.highBid = action.bid;

            const passed = (s: Seat) => next.bids[s] === 'pass';
            const passes = SEATS.filter(passed).length;
            const maxedOut = next.highBid === VALID_BIDS[VALID_BIDS.length - 1];

            if ((passes === 3 && next.highBid !== null) || maxedOut) {
                // Bidding is over — last live bidder wins.
                const winner = maxedOut
                    ? action.seat
                    : SEATS.find((s) => !passed(s))!;
                next.bidWinner = winner;
                next.phase = 'widow';
                next.turn = winner;
                // widow goes into the winner's hand; they'll pick the go-down
                next.hands[winner] = [...next.hands[winner], ...next.widow];
                next.widow = [];
                return next;
            }

            // advance to the next seat that hasn't passed
            let t = nextSeat(action.seat);
            while (passed(t)) t = nextSeat(t);
            next.turn = t;
            return next;
        }
        case 'SELECT_GODOWN': {
            next.goDown = action.cards;
            next.hands[action.seat] = next.hands[action.seat].filter(
                (c) => !action.cards.some((sel) => sameCard(sel, c)),
            );
            next.phase = 'trump';
            next.turn = action.seat;
            return next;
        }
        case 'SELECT_TRUMP': {
            next.trump = action.suit;
            next.phase = 'playing';
            next.trickLeader = bidLead(next.dealer!);
            next.turn = next.trickLeader;
            next.trickPlays = [];
            return next;
        }
        case 'PLAY_CARD': {
            playCardOnDraft(next, action.seat, action.card);
            return next;
        }
        case 'LAYDOWN': {
            // Deterministic fast-forward: the claimant leads every remaining
            // card (strongest first, for a satisfying trick record) and
            // everyone else follows with their lowest legal card. isLaydown
            // guaranteed each lead wins, so this is just the PLAY_CARD path
            // run to the end of the hand — replays reproduce it exactly.
            while (next.phase === 'playing') {
                const turn = next.turn!;
                const card = turn === action.seat
                    ? sortHand(next.hands[turn], next.trump)[0]
                    : lowestLegalCard(next, turn);
                playCardOnDraft(next, turn, card);
            }
            return next;
        }
        case 'NEXT_HAND': {
            next.handNumber = g.handNumber + 1;
            next.dealer = nextSeat(g.dealer!);
            next.turn = next.dealer;
            next.phase = 'dealing';
            next.hands = emptyHands();
            next.widow = [];
            next.goDown = [];
            next.bids = {};
            next.bidLog = [];
            next.highBid = null;
            next.bidWinner = null;
            next.trump = null;
            next.trickPlays = [];
            next.trickLeader = null;
            next.completedTricks = [];
            next.tricksWon = { A: 0, B: 0 };
            next.pointsTaken = { A: 0, B: 0 };
            next.redealSeat = null;
            // Integrity invariant (prod incident 2026-07-14, game 8563im…: trump
    // observed flipping Red -> Yellow mid-hand): within a hand, once trump
    // is set it is immutable. No current action can violate this; the guard
    // makes the property structural so no future action ever can.
    if (g.trump !== null && next.handNumber === g.handNumber
        && next.trump !== g.trump) {
        throw new InvalidActionError('Trump cannot change mid-hand');
    }

    return next;
        }
    }
};

/** Play `card` from `seat` on the draft: trick bookkeeping + end-of-hand scoring. */
const playCardOnDraft = (next: GameDoc, seat: Seat, card: Card): void => {
    next.hands[seat] = next.hands[seat].filter((c) => !sameCard(c, card));
    next.trickPlays = [...next.trickPlays, { seat, card }];

    if (next.trickPlays.length < 4) {
        next.turn = nextSeat(seat);
        return;
    }

    // --- trick complete ---
    const winner = winningCardSeat(next.trickPlays, next.trump);
    const points = trickPoints(next.trickPlays);
    const winningTeam = teamOf(winner);
    next.completedTricks = [...next.completedTricks, {
        leader: next.trickLeader!,
        plays: next.trickPlays,
        winner,
        points,
    }];
    next.tricksWon[winningTeam] += 1;
    next.pointsTaken[winningTeam] += points;
    next.trickPlays = [];
    next.trickLeader = winner;
    next.turn = winner;

    if (next.completedTricks.length === TRICKS_PER_HAND) {
        scoreHand(next, winner);
    }
};

/** Deterministic follower's card for a laydown: lowest legal, suits tie-broken in SUITS order. */
const lowestLegalCard = (g: GameDoc, seat: Seat): Card =>
    [...legalCards(g, seat)].sort(
        (a, b) => a.number - b.number || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit),
    )[0];

/** Score a finished hand (mutates the draft). `lastTrickWinner` claims the go-down. */
const scoreHand = (g: GameDoc, lastTrickWinner: Seat): void => {
    const gdPoints = goDownPoints(g);
    const pointsTaken: Record<Team, number> = { ...g.pointsTaken };
    pointsTaken[teamOf(lastTrickWinner)] += gdPoints;
    if (g.tricksWon.A >= 5) pointsTaken.A += TAKING_TRICKS_BONUS;
    if (g.tricksWon.B >= 5) pointsTaken.B += TAKING_TRICKS_BONUS;

    const bidTeam = teamOf(g.bidWinner!);
    const defTeam: Team = bidTeam === 'A' ? 'B' : 'A';
    const bid = g.highBid!;
    const wentSet = pointsTaken[bidTeam] < bid;

    const handScore: Record<Team, number> = { A: 0, B: 0 };
    handScore[bidTeam] = wentSet ? -bid : pointsTaken[bidTeam];
    handScore[defTeam] = pointsTaken[defTeam];

    g.scores.A += handScore.A;
    g.scores.B += handScore.B;

    const summary: HandSummary = {
        handNumber: g.handNumber,
        dealer: g.dealer!,
        bidWinner: g.bidWinner!,
        bid,
        trump: g.trump!,
        tricksWon: { ...g.tricksWon },
        pointsTaken,
        handScore,
        wentSet,
        goDownPoints: gdPoints,
        bids: { ...g.bids },
        bidLog: [...(g.bidLog ?? [])],
        // no spread-of-undefined: Firestore rejects undefined fields
        ...(g.dealtHands ? { dealtHands: g.dealtHands, dealtWidow: g.dealtWidow ?? [] } : {}),
    };
    g.handHistory = [...g.handHistory, summary];

    // game over?
    const over =
        g.scores.A >= WIN_SCORE || g.scores.B >= WIN_SCORE ||
        g.scores.A <= LOSE_SCORE || g.scores.B <= LOSE_SCORE;

    if (over && g.scores.A !== g.scores.B) {
        g.winner = g.scores.A > g.scores.B ? 'A' : 'B';
        g.phase = 'game_over';
        g.status = 'completed';
        g.turn = null;
    } else {
        // (a dead-even tie across a threshold keeps the game going)
        g.phase = 'hand_done';
        g.turn = null;
    }
};

/** Rebuild a game from its action log (for reviews/replays). */
export const replay = (initial: GameDoc, actions: GameAction[]): GameDoc =>
    actions.reduce((state, a) => applyAction(state, a), initial);
