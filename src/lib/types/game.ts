export type PlayerType = 'human' | 'bot';

export type Seat = 'A1' | 'B1' | 'A2' | 'B2';

export type Team = 'A' | 'B';

export type Suit = 'Red' | 'Yellow' | 'Black' | 'Green';

export type GamePhase = 
    | 'setup'     // Initial game setup
    | 'dealing'   // Dealer is dealing cards
    | 'bidding'   // Players are bidding
    | 'widow'     // Bid winner selecting go-down cards
    | 'trump'     // Bid winner selecting trump suit
    | 'playing';  // Playing tricks

export interface Card {
    suit: Suit;
    number: number;
    points: number;
}

export interface Player {
    id: string;
    name: string;
    type: PlayerType;
    seat?: Seat;
    ready: boolean;
    hand?: Card[];
    bid?: number | 'pass';
}

export interface GameState {
    id: string;
    status: 'waiting' | 'starting' | 'active' | 'completed';
    phase?: GamePhase;
    players: Record<Seat, Player | null>;
    currentTurn?: Seat;
    dealer?: Seat;
    bidWinner?: Seat;
    currentBid?: number;
    trump?: Suit;
    widow?: Card[];
    goDown?: Card[];
    trickCards?: Record<Seat, Card | null>;
    trickWinner?: Seat;
    trickLeader?: Seat;
    trickComplete?: boolean;
    playOrder?: Seat[];  // Track the order cards were played in the current trick
    tricks: {
        A: number;
        B: number;
    };
    scores: {
        A: number;
        B: number;
    };
    created: Date;
}

// Constants for game rules
export const VALID_BIDS = [65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120];
export const CARDS_PER_PLAYER = 9;
export const WIDOW_SIZE = 4;
export const MIN_SCORE = -250;
export const MAX_SCORE = 500;

// Helper function to calculate card points
export const getCardPoints = (number: number): number => {
    if (number === 5) return 5;
    if (number === 10 || number === 13) return 10;
    return 0;
}; 