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

// Bot styles. The lobby offers the trained AlphaRook brains (the frozen
// champions from ml/ self-play training, via src/lib/alpharook); the rest are
// kept so game docs created before them keep working:
//   gen11      — gen10's brain inside PIMC look-ahead: endgame card plays
//                are chosen by imagining 8 hidden-card worlds and playing
//                each out with the net (beats pure gen10 54% duplicate-deck,
//                65/35 at marathon rules in the Python lab). Same weights
//                as gen10 — the strength is calculation, not new training
//   gen10      — the ladder's latest reflex net: trained against frozen
//                gen9, fully neural like it (edges gen9 head-to-head; beats
//                every older generation harder than gen9 does)
//   gen9       — first FULLY neural brain: bids, trump intent, go-down, and
//                card play all learned (beat gen8 57.5% over 400
//                duplicate-deck games)
//   gen8       — neural bid + play, family-heuristic go-down/trump (beat
//                gen7 63/37; 87.5% vs the old Standard heuristic)
//   gen7       — first neural champion (94.5% vs Standard)
//   alpharook  — legacy: phase-1/2 Monte Carlo search bot
//   random/basic/aggressive/cautious — legacy heuristic personalities
//                (bots.ts PERSONALITIES); 'basic' is also the fallback brain
//                for gen7/gen8 go-down/trump and for neural seats if weights
//                fail to load
export type BotStyle = 'random' | 'basic' | 'aggressive' | 'cautious' | 'alpharook' | 'gen7' | 'gen8' | 'gen9' | 'gen10' | 'gen11' | 'gen13' | 'gen16';

export const BOT_STYLE_LABELS: Record<BotStyle, string> = {
    random: 'Easy',
    basic: 'Standard',
    aggressive: 'Aggressive',
    cautious: 'Cautious',
    alpharook: 'AlphaRook Classic',
    gen7: 'AlphaRook Gen7',
    gen8: 'AlphaRook Gen8',
    gen9: 'AlphaRook Gen9',
    gen10: 'AlphaRook Gen10',
    gen11: 'AlphaRook Gen11',
    gen13: 'AlphaRook Gen13',
    gen16: 'AlphaRook Gen16',
};

/** What the lobby's bot picker offers (strongest first); legacy styles live on only in old games. */
export const PLAYABLE_BOT_STYLES: BotStyle[] = ['gen16', 'gen13', 'gen11', 'gen10', 'gen9', 'gen8', 'gen7'];

/** Every new bot starts as the hottest brain we've shipped. */
export const DEFAULT_BOT_STYLE: BotStyle = PLAYABLE_BOT_STYLES[0];

// The camp roster: the family's Rook-camp names for the seven AlphaRook
// brains. The camp ranks them Stomper (the rookie) up to Cosmo (the
// grandmaster), so the names run WEAKEST → strongest against the gens.
// Purely cosmetic — the real strength is still the AI·<gen> chip on the
// badge. `img` points at an optional portrait under public/bots/; when the
// file is missing the badge falls back to the emoji, so this all works
// before the art lands.
export interface BotPersona {
    name: string;
    emoji: string;
    img: string; // /bots/<key>.png
    tagline: string;
}
export const BOT_PERSONAS: Partial<Record<BotStyle, BotPersona>> = {
    gen16: { name: 'Cosmo', emoji: '🐾', img: '/bots/07-Cosmo.jpg', tagline: 'the grandmaster' },
    gen13: { name: 'Cougar', emoji: '🐅', img: '/bots/06-Cougar.jpg', tagline: 'seasoned prowler' },
    gen11: { name: 'Puma', emoji: '🐈‍⬛', img: '/bots/05-Puma.jpg', tagline: 'silent hunter' },
    gen10: { name: 'Cub', emoji: '🦁', img: '/bots/04-Cub.jpg', tagline: 'young lion' },
    gen9: { name: 'Bobcat', emoji: '🐆', img: '/bots/03-Bobcat.jpg', tagline: 'quick and cunning' },
    gen8: { name: 'Kitten', emoji: '🐱', img: '/bots/02-Kitten.jpg', tagline: 'small but sharp' },
    gen7: { name: 'Stomper', emoji: '🦖', img: '/bots/01-Stomper.jpg', tagline: 'the rookie' },
};

/** The camp persona for a style, or a plain fallback for the heuristic bots. */
export const personaFor = (style: BotStyle | undefined): BotPersona =>
    (style && BOT_PERSONAS[style]) || {
        name: style ? BOT_STYLE_LABELS[style] : 'Bot',
        emoji: '🤖', img: '', tagline: '',
    };

// Bot table names: BYU legends, the family pantheon. A bot's NAME is who it
// is at the table; its brain (botStyle) is how it plays — decoupled, so a
// table of three gen16s isn't three players all called Cosmo. The camp
// characters above stay on as the brain labels in the lobby picker.
export const BOT_NAMES: string[] = [
    'LaVell Edwards', 'Jimmer Fredette', 'Danny Ainge', 'Steve Young',
    'Ty Detmer', 'Jim McMahon', 'Robbie Bosco', 'Gifford Nielsen',
];

/**
 * Deterministic name draw (the engine must stay pure — same trick as the
 * first-dealer pick): rotate the roster by a game-id hash, take the first
 * name whose FIRST name is free at the table — badges only show first names,
 * so "Jim" and "Jimmer" can coexist but two Jims cannot.
 */
export const pickBotName = (gameId: string, takenNames: string[]): string => {
    const taken = new Set(takenNames.map((n) => n.split(' ')[0]));
    const hash = Array.from(gameId).reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
    for (let i = 0; i < BOT_NAMES.length; i++) {
        const name = BOT_NAMES[(hash + i) % BOT_NAMES.length];
        if (!taken.has(name.split(' ')[0])) return name;
    }
    return 'Cosmo'; // 8 legends, 4 seats — unreachable, but never crash a deal
};

export interface SeatInfo {
    kind: 'human' | 'bot' | 'open';
    uid?: string; // for humans, the Firebase auth uid
    name: string;
    photoURL?: string;
    botStyle?: BotStyle;
    assist?: boolean; // this human has the AI trainer switched on (table-visible)
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
    // Snapshot of how the hand started (absent on games from before this
    // was recorded): what everyone was dealt, the widow, and each seat's
    // final word in the auction. Feeds the recap's deal view and the
    // Trophy Case stats.
    dealtHands?: Record<Seat, Card[]>;
    dealtWidow?: Card[];
    bids?: Partial<Record<Seat, number | 'pass'>>;
    /** every bid in order — "95, then 105, then pass…" */
    bidLog?: { seat: Seat; bid: number | 'pass' }[];
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
    /** The deal as it left the dealer's hands (before the widow pickup),
     *  kept for the hand recap. Absent on games created before it existed. */
    dealtHands?: Record<Seat, Card[]>;
    dealtWidow?: Card[];

    // bidding
    bids: Partial<Record<Seat, number | 'pass'>>;
    /** the auction blow-by-blow, in the order it happened this hand
     *  (absent on games from before it was recorded) */
    bidLog?: { seat: Seat; bid: number | 'pass' }[];
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
    // who claimed the rest of the hand with all winners, and how many tricks
    // were on the table when they did — drives the table-wide announcement
    // and the recap's "laid them down" beat. Absent on older game docs.
    laydownSeat?: Seat | null;
    laydownTrick?: number | null;
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
    | { type: 'LAYDOWN'; seat: Seat }     // every remaining card is a lock — claim the rest
    | { type: 'SET_ASSIST'; seat: Seat; on: boolean } // toggle the AI trainer (table-visible)
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
