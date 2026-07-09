// Core Rook13 game types.
// The engine state (GameDoc) is a plain JSON-serializable object so it can be
// stored in Firestore, replayed from an action log, and unit tested.

export type Seat = 'A1' | 'B1' | 'A2' | 'B2';
export type Team = 'A' | 'B';
export type Suit = 'Red' | 'Yellow' | 'Black' | 'Green';

export const SEATS: Seat[] = ['A1', 'B1', 'A2', 'B2'];
export const SUITS: Suit[] = ['Red', 'Yellow', 'Black', 'Green'];
export const VALID_BIDS = [65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120];
export const CARDS_PER_PLAYER = 9;
export const WIDOW_SIZE = 4;
export const TRICKS_PER_HAND = 9;
export const WIN_SCORE = 500;
export const LOSE_SCORE = -250;
export const TAKING_TRICKS_BONUS = 20;

export interface Card {
    suit: Suit;
    number: number; // 5..14
}

// Bot styles. The lobby offers the trained AlphaRook brains (gen7/gen8, the
// frozen champions from ml/ self-play training — neural bidding & card play
// via src/lib/alpharook); the rest are kept so game docs created before them
// keep working:
//   gen8       — reigning champion (beat gen7 63/37 over 300 duplicate-deck
//                games; 87.5% vs the old Standard heuristic)
//   gen7       — first neural champion (94.5% vs Standard)
//   alpharook  — legacy: phase-1/2 Monte Carlo search bot
//   random/basic/aggressive/cautious — legacy heuristic personalities
//                (bots.ts PERSONALITIES); 'basic' is also the fallback brain
//                for go-down/trump and for neural seats if weights fail to load
export type BotStyle = 'random' | 'basic' | 'aggressive' | 'cautious' | 'alpharook' | 'gen7' | 'gen8';

export const BOT_STYLE_LABELS: Record<BotStyle, string> = {
    random: 'Easy',
    basic: 'Standard',
    aggressive: 'Aggressive',
    cautious: 'Cautious',
    alpharook: 'AlphaRook Classic',
    gen7: 'AlphaRook Gen7',
    gen8: 'AlphaRook Gen8',
};

/** What the lobby's bot picker offers (strongest first); legacy styles live on only in old games. */
export const PLAYABLE_BOT_STYLES: BotStyle[] = ['gen8', 'gen7'];

export interface SeatInfo {
    kind: 'human' | 'bot' | 'open';
    uid?: string; // for humans, the Firebase auth uid
    name: string;
    photoURL?: string;
    botStyle?: BotStyle;
}

export type Phase =
    | 'lobby'        // waiting for seats to fill / host to start
    | 'dealing'      // waiting for dealer to deal
    | 'redeal'       // a redeal hand (all 6-9) was detected — celebrate, then redeal
    | 'bidding'
    | 'widow'        // bid winner picks 4 go-down cards
    | 'trump'        // bid winner declares trump
    | 'playing'
    | 'hand_done'    // hand scored, waiting to start next hand
    | 'game_over';

export interface TrickRecord {
    leader: Seat;
    plays: { seat: Seat; card: Card }[]; // in play order
    winner: Seat;
    points: number;
}

export interface HandSummary {
    handNumber: number;
    dealer: Seat;
    bidWinner: Seat;
    bid: number;
    trump: Suit;
    tricksWon: Record<Team, number>;
    pointsTaken: Record<Team, number>; // raw card points incl. go-down + bonus
    handScore: Record<Team, number>;   // what was added to the game score
    wentSet: boolean;
    goDownPoints: number;
}

export interface GameDoc {
    // --- lobby/meta ---
    id: string;
    joinCode: string;
    hostUid: string;
    createdAt: number;   // epoch ms
    updatedAt: number;
    status: 'lobby' | 'active' | 'completed';
    seats: Record<Seat, SeatInfo>;
    /** uids of humans seated, for querying "my games" */
    playerUids: string[];

    // --- engine state ---
    phase: Phase;
    actionCount: number; // optimistic-concurrency version; each applied action increments
    handNumber: number;  // 1-based
    dealer: Seat | null;
    turn: Seat | null;   // whose input the game is waiting on (null in lobby/hand_done)

    /** Private-ish: hands keyed by seat. Visible to clients; UI hides others' cards. */
    hands: Record<Seat, Card[]>;
    widow: Card[];
    goDown: Card[];

    // bidding
    bids: Partial<Record<Seat, number | 'pass'>>;
    highBid: number | null;
    bidWinner: Seat | null;
    trump: Suit | null;

    // trick play
    trickPlays: { seat: Seat; card: Card }[]; // current trick, in order
    trickLeader: Seat | null;
    completedTricks: TrickRecord[];
    /** the last completed trick sticks around for the "last trick" viewer */
    tricksWon: Record<Team, number>;
    /** raw card points captured so far this hand (excl. go-down/bonus) */
    pointsTaken: Record<Team, number>;

    // scores
    scores: Record<Team, number>;
    handHistory: HandSummary[];

    // special
    redealSeat: Seat | null; // seat that triggered the celebrated redeal
    redealCount: number;     // total redeals this game (for the wow factor)
    winner: Team | null;
}

// ---------------------------------------------------------------------------
// Actions. Every mutation of a game flows through one of these, giving us a
// complete audit log and deterministic replays.
// ---------------------------------------------------------------------------

export type GameAction =
    | { type: 'SIT'; seat: Seat; player: { uid: string; name: string; photoURL?: string } }
    | { type: 'LEAVE_SEAT'; seat: Seat; uid: string }
    | { type: 'SET_BOT'; seat: Seat; botStyle: BotStyle; name?: string }
    | { type: 'OPEN_SEAT'; seat: Seat }   // host reopens a bot seat
    | { type: 'START_GAME' }              // host only; fills remaining seats with bots
    | { type: 'DEAL'; deck: Card[] }      // dealer provides a shuffled deck
    | { type: 'ACK_REDEAL'; deck: Card[] } // after the celebration, redeal with a fresh deck
    | { type: 'BID'; seat: Seat; bid: number | 'pass' }
    | { type: 'SELECT_GODOWN'; seat: Seat; cards: Card[] }
    | { type: 'SELECT_TRUMP'; seat: Seat; suit: Suit }
    | { type: 'PLAY_CARD'; seat: Seat; card: Card }
    | { type: 'NEXT_HAND' };              // from hand_done -> dealing

export interface LoggedAction {
    index: number;
    at: number; // epoch ms
    action: GameAction;
    /** uid of the client that submitted it ('bot' for bot moves) */
    by: string;
}

export const getCardPoints = (card: Card): number => {
    if (card.number === 5) return 5;
    if (card.number === 10 || card.number === 13) return 10;
    return 0;
};

export const teamOf = (seat: Seat): Team => seat.charAt(0) as Team;

export const partnerOf = (seat: Seat): Seat => {
    const idx = SEATS.indexOf(seat);
    return SEATS[(idx + 2) % 4];
};

export const nextSeat = (seat: Seat): Seat => {
    const idx = SEATS.indexOf(seat);
    return SEATS[(idx + 1) % 4];
};

export const sameCard = (a: Card, b: Card): boolean =>
    a.suit === b.suit && a.number === b.number;

export const cardKey = (c: Card): string => `${c.suit}-${c.number}`;
