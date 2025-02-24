import { Card, Suit, getCardPoints } from '../types/game';

// Create a full deck of cards
export const createDeck = (): Card[] => {
    const suits: Suit[] = ['Red', 'Yellow', 'Black', 'Green'];
    const deck: Card[] = [];

    for (const suit of suits) {
        for (let number = 5; number <= 14; number++) {
            deck.push({
                suit,
                number,
                points: getCardPoints(number),
            });
        }
    }

    return deck;
};

// Shuffle an array using Fisher-Yates algorithm
export const shuffleArray = <T>(array: T[]): T[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
};

// Deal cards to players
export const dealCards = (deck: Card[]) => {
    const shuffledDeck = shuffleArray(deck);
    
    // Deal 9 cards to each of 4 positions (36 cards)
    const hands = {
        A1: shuffledDeck.slice(0, 9),
        B1: shuffledDeck.slice(9, 18),
        A2: shuffledDeck.slice(18, 27),
        B2: shuffledDeck.slice(27, 36),
    };
    
    // Last 4 cards become the widow
    const widow = shuffledDeck.slice(36, 40);
    
    return { hands, widow };
};

// Calculate points in a set of cards
export const calculatePoints = (cards: Card[]): number => {
    return cards.reduce((sum, card) => sum + card.points, 0);
};

// Check if a card can be legally played
export const canPlayCard = (
    card: Card,
    leadSuit: Suit | null,
    hand: Card[]
): boolean => {
    // If no lead suit, any card can be played
    if (!leadSuit) return true;
    
    // Check if player has any cards of lead suit
    const hasLeadSuit = hand.some(c => c.suit === leadSuit);
    
    // If player has lead suit cards, they must play one
    if (hasLeadSuit) {
        return card.suit === leadSuit;
    }
    
    // If player has no cards of lead suit, any card can be played
    return true;
};

// Determine which card wins a trick
export const determineTrickWinner = (
    cards: Record<string, Card>,
    leadSuit: Suit,
    trump: Suit | null
): string => {
    // First: Check if any trump cards were played
    const trumpCards = trump 
        ? Object.entries(cards).filter(([_, card]) => card.suit === trump)
        : [];

    // If any trump cards were played, highest trump wins
    if (trumpCards.length > 0) {
        const [winningSeat] = trumpCards.reduce((highest, current) => 
            current[1].number > highest[1].number ? current : highest
        );
        return winningSeat;
    }

    // No trump played, find cards of lead suit
    const leadSuitCards = Object.entries(cards).filter(([_, card]) => card.suit === leadSuit);
    
    // If any lead suit cards were played, highest lead suit wins
    if (leadSuitCards.length > 0) {
        const [winningSeat] = leadSuitCards.reduce((highest, current) => 
            current[1].number > highest[1].number ? current : highest
        );
        return winningSeat;
    }

    // If no lead suit cards were played (everyone was void), 
    // find the first card played of any suit
    const [firstPlayedSeat] = Object.entries(cards).find(([_, card]) => card !== null) || [''];
    return firstPlayedSeat;
}; 