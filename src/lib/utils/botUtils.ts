import { Card, Player, Seat, Suit, VALID_BIDS } from '../types/game';
import { calculatePoints } from './cardUtils';

// Helper function to calculate suit power
const calculateSuitPower = (cards: Card[]): number => {
    return cards.reduce((sum, card) => sum + card.number, 0);
};

// Helper function to find best trump suit
const findBestTrumpSuit = (hand: Card[]): Suit => {
    // Group cards by suit
    const cardsBySuit = hand.reduce((acc, card) => {
        if (!acc[card.suit]) acc[card.suit] = [];
        acc[card.suit].push(card);
        return acc;
    }, {} as Record<Suit, Card[]>);

    // Calculate power and length for each suit
    const suitMetrics = Object.entries(cardsBySuit).map(([suit, cards]) => ({
        suit: suit as Suit,
        length: cards.length,
        power: calculateSuitPower(cards)
    }));

    // Sort by length first, then by power
    suitMetrics.sort((a, b) => {
        if (a.length !== b.length) return b.length - a.length;
        return b.power - a.power;
    });

    return suitMetrics[0].suit;
};

// Helper function to select Go Down cards
const selectGoDownCards = (hand: Card[], trumpSuit: Suit): Card[] => {
    // Group cards by suit
    const cardsBySuit = hand.reduce((acc, card) => {
        if (!acc[card.suit]) acc[card.suit] = [];
        acc[card.suit].push(card);
        return acc;
    }, {} as Record<Suit, Card[]>);

    // Sort cards in each suit by value (ascending)
    Object.values(cardsBySuit).forEach(cards => {
        cards.sort((a, b) => a.number - b.number);
    });

    // Remove trump suit from consideration
    delete cardsBySuit[trumpSuit];

    // Select the 4 weakest cards from non-trump suits
    const goDownCards: Card[] = [];
    
    // First, take the weakest cards from the shortest suits
    const nonTrumpSuits = Object.entries(cardsBySuit)
        .sort(([, cardsA], [, cardsB]) => cardsA.length - cardsB.length);

    for (const [, cards] of nonTrumpSuits) {
        // Take weakest cards from this suit
        while (cards.length > 0 && goDownCards.length < 4) {
            goDownCards.push(cards.shift()!);
        }
        if (goDownCards.length === 4) break;
    }

    return goDownCards;
};

// Enhanced bot bidding strategy based on hand strength and partner's actions
export const decideBotBid = (
    hand: Card[],
    currentBid: number | null,
    passes: number,
    currentTurn: Seat,
    dealer: Seat,
    players: Record<Seat, { type: 'human' | 'bot'; name: string; hand?: Card[]; bid?: number | 'pass' }>,
    previousBids: Record<Seat, number | 'pass'>
): number | 'pass' => {
    // If we've already passed in a previous round, we must pass again
    if (previousBids[currentTurn] === 'pass') {
        return 'pass';
    }

    // If we're the last bidder (3 passes) we MUST bid minimum 65
    if (passes === 3) {
        return VALID_BIDS[0]; // 65
    }

    // Find the best trump suit first
    const trumpSuit = findBestTrumpSuit(hand);
    const trumpCards = hand.filter(card => card.suit === trumpSuit);
    
    // Calculate hand strength based on trump suit and remaining cards
    const goDownCards = selectGoDownCards(hand, trumpSuit);
    const playingCards = hand.filter(card => 
        !goDownCards.some(gc => gc.suit === card.suit && gc.number === card.number)
    );

    // Calculate points and power
    const trumpPoints = trumpCards.reduce((sum, card) => sum + (card.points || 0), 0);
    const trumpPower = calculateSuitPower(trumpCards);
    const totalPoints = playingCards.reduce((sum, card) => sum + (card.points || 0), 0);
    
    // Calculate hand strength considering:
    // 1. Trump length (most important)
    // 2. Trump points
    // 3. Trump power (high cards)
    // 4. Total points in hand
    let handStrength = 
        (trumpCards.length * 10) +  // Length of trump suit (10 points per card)
        (trumpPoints * 3) +         // Points in trump (3 points per point card)
        (trumpPower / 2) +          // Power of trump cards
        totalPoints;                 // Points in other suits

    // Find our partner's seat and their bid
    const seats: Seat[] = ['A1', 'B1', 'A2', 'B2'];
    const currentIndex = seats.indexOf(currentTurn);
    const partnerSeat = seats[(currentIndex + 2) % 4];
    const partnerBid = previousBids[partnerSeat];

    // If partner made a real bid (not pass), be more aggressive
    if (typeof partnerBid === 'number') {
        handStrength += 15;
    }

    // Determine bid based on hand strength
    let bidIndex = -1;
    if (handStrength >= 120) bidIndex = 11;      // Bid 120
    else if (handStrength >= 110) bidIndex = 9;  // Bid 110
    else if (handStrength >= 100) bidIndex = 7;  // Bid 100
    else if (handStrength >= 90) bidIndex = 5;   // Bid 90
    else if (handStrength >= 80) bidIndex = 3;   // Bid 80
    else if (handStrength >= 70) bidIndex = 1;   // Bid 70
    else if (handStrength >= 65) bidIndex = 0;   // Bid 65

    // If we have a valid bid index
    if (bidIndex >= 0) {
        // If there's a current bid, we need to bid higher
        if (currentBid) {
            // Find the next valid bid above the current bid
            const nextBidIndex = VALID_BIDS.findIndex(bid => bid > currentBid);
            // If we can't or shouldn't bid higher, pass
            if (nextBidIndex === -1 || nextBidIndex > bidIndex) {
                return 'pass';
            }
            // Return the next valid bid
            return VALID_BIDS[nextBidIndex];
        }
        // No current bid, return our calculated bid
        return VALID_BIDS[bidIndex];
    }

    // Hand too weak to bid
    return 'pass';
};

// Enhanced bot trump selection strategy
export const decideBotTrump = (hand: Card[]): Suit => {
    return findBestTrumpSuit(hand);
};

// Enhanced bot card playing strategy
export const decideBotCard = (
    hand: Card[],
    leadSuit: Suit | null,
    trump: Suit | null,
    playedCards: Card[],
    trickCards: Record<Seat, Card | null>,
    currentTurn: Seat,
    trickLeader: Seat
): Card => {
    // Safety check - if hand is empty, throw error
    if (!hand || hand.length === 0) {
        throw new Error('Bot has no cards to play');
    }

    // Get valid cards based on lead suit
    const validCards = hand.filter(card => {
        if (!leadSuit) return true;
        const hasLeadSuit = hand.some(c => c.suit === leadSuit);
        return hasLeadSuit ? card.suit === leadSuit : true;
    });

    // Safety check - if no valid cards, return first card in hand
    if (validCards.length === 0) {
        console.warn('No valid cards found, returning first card in hand');
        return hand[0];
    }

    // Helper function to check if we're winning the trick
    const isWinningTrick = (card: Card): boolean => {
        try {
            const allCards = [...Object.values(trickCards).filter((c): c is Card => c !== null), card];
            if (trump) {
                const trumpCards = allCards.filter(c => c.suit === trump);
                if (trumpCards.length > 0) {
                    return card.suit === trump && card.number > Math.max(...trumpCards.map(c => c.number));
                }
            }
            const leadCards = allCards.filter(c => c.suit === leadSuit);
            return card.suit === leadSuit && card.number > Math.max(...leadCards.map(c => c.number));
        } catch (error) {
            console.warn('Error checking winning trick:', error);
            return false;
        }
    };

    try {
        // If we're leading
        if (!leadSuit) {
            // Lead trump early to deplete opponents
            if (trump && hand.some(c => c.suit === trump)) {
                const trumpCards = validCards.filter(c => c.suit === trump);
                if (trumpCards.length > 0) {
                    return trumpCards.reduce((highest, card) => 
                        card.number > highest.number ? card : highest
                    , trumpCards[0]);
                }
            }

            // Lead high cards from long suits
            const suitCounts = hand.reduce((counts, card) => {
                counts[card.suit] = (counts[card.suit] || 0) + 1;
                return counts;
            }, {} as Record<Suit, number>);

            const longSuitCards = validCards.filter(card => 
                suitCounts[card.suit] >= 3 && card.number >= 10
            );

            if (longSuitCards.length > 0) {
                return longSuitCards.reduce((highest, card) => 
                    card.number > highest.number ? card : highest
                , longSuitCards[0]);
            }

            // Otherwise lead lowest card
            return validCards.reduce((lowest, card) =>
                card.number < lowest.number ? card : lowest
            , validCards[0]);
        }

        // Following suit
        const followSuitCards = validCards.filter(c => c.suit === leadSuit);
        if (followSuitCards.length > 0) {
            // If we can win the trick and there are points
            const pointsInTrick = Object.values(trickCards)
                .filter((c): c is Card => c !== null)
                .reduce((sum, c) => sum + (c.points || 0), 0);

            if (pointsInTrick > 0) {
                const winningCards = followSuitCards.filter(isWinningTrick);
                if (winningCards.length > 0) {
                    return winningCards.reduce((lowest, card) =>
                        card.number < lowest.number ? card : lowest
                    , winningCards[0]);
                }
            }

            // If we can't win, play our lowest card
            return followSuitCards.reduce((lowest, card) =>
                card.number < lowest.number ? card : lowest
            , followSuitCards[0]);
        }

        // If we can't follow suit and have trump
        if (trump) {
            const trumpCards = validCards.filter(c => c.suit === trump);
            if (trumpCards.length > 0) {
                const pointsInTrick = Object.values(trickCards)
                    .filter((c): c is Card => c !== null)
                    .reduce((sum, c) => sum + (c.points || 0), 0);

                // Only trump if there are points or we're early in the trick
                if (pointsInTrick > 0 || Object.values(trickCards).filter(c => c !== null).length <= 2) {
                    return trumpCards.reduce((lowest, card) =>
                        card.number < lowest.number ? card : lowest
                    , trumpCards[0]);
                }
            }
        }

        // If we can't follow suit and don't want to trump
        // Play our lowest point card
        return validCards.reduce((lowest, card) =>
            (card.points || 0) < (lowest.points || 0) || 
            ((card.points || 0) === (lowest.points || 0) && card.number < lowest.number)
                ? card
                : lowest
        , validCards[0]);
    } catch (error) {
        console.warn('Error in decideBotCard:', error);
        // Fallback to first valid card if any error occurs
        return validCards[0];
    }
}; 