import { Card, Player, Suit, VALID_BIDS } from '../types/game';
import { calculatePoints } from './cardUtils';

// Simple bot bidding strategy
export const decideBotBid = (
    hand: Card[],
    currentBid: number | undefined,
    passes: number
): number | 'pass' => {
    // If we're the last bidder (3 passes), we must bid minimum
    if (passes === 3) {
        return currentBid || VALID_BIDS[0];
    }

    // Calculate total points in hand
    const points = calculatePoints(hand);
    
    // Count high cards (10 and above) and cards of the same suit
    const suitCounts = hand.reduce((counts, card) => {
        counts[card.suit] = (counts[card.suit] || 0) + 1;
        return counts;
    }, {} as Record<Suit, number>);

    const highCards = hand.filter(card => card.number >= 10).length;
    const maxSuitCount = Math.max(...Object.values(suitCounts));
    
    // Calculate hand strength (0-100)
    let handStrength = 0;
    handStrength += points * 2; // Points are important
    handStrength += highCards * 5; // High cards are valuable
    handStrength += maxSuitCount * 8; // Having many cards of one suit is very good

    // Add some randomness to the hand strength (-10 to +10)
    handStrength += Math.floor(Math.random() * 21) - 10;

    // 50% chance to pass regardless of hand strength
    if (Math.random() < 0.5 && passes < 3) {
        return 'pass';
    }

    // If current bid is too high for our hand strength, pass
    if (currentBid) {
        const bidTooHigh = currentBid > (handStrength * 0.8);
        if (bidTooHigh && passes < 3) {
            return 'pass';
        }
    }

    // Determine bid based on hand strength
    if (!currentBid) {
        if (handStrength >= 90) return 90;
        if (handStrength >= 80) return 80;
        if (handStrength >= 70) return 70;
        return 65;
    }

    // If we have a strong hand, consider raising
    if (handStrength > currentBid + 10) {
        const nextBid = VALID_BIDS.find(bid => bid > currentBid);
        return nextBid || 'pass';
    }

    return 'pass';
};

// Simple bot trump selection strategy
export const decideBotTrump = (hand: Card[]): Suit => {
    // Count cards of each suit
    const suitCounts = hand.reduce((counts, card) => {
        counts[card.suit] = (counts[card.suit] || 0) + 1;
        return counts;
    }, {} as Record<Suit, number>);
    
    // Find suit with most cards
    let bestSuit: Suit = 'Red';
    let maxCount = 0;
    
    Object.entries(suitCounts).forEach(([suit, count]) => {
        if (count > maxCount) {
            maxCount = count;
            bestSuit = suit as Suit;
        }
    });
    
    return bestSuit;
};

// Simple bot card playing strategy
export const decideBotCard = (
    hand: Card[],
    leadSuit: Suit | null,
    trump: Suit | null,
    playedCards: Card[]
): Card => {
    // Check for empty hand
    if (!hand || hand.length === 0) {
        throw new Error('Bot has no cards to play');
    }

    // Get all valid cards that can be played
    const validCards = hand.filter(card => {
        // If no lead suit, any card is valid
        if (!leadSuit) return true;
        
        // Check if player has any cards of lead suit
        const hasLeadSuit = hand.some(c => c.suit === leadSuit);
        
        // If player has lead suit cards, they must play one
        if (hasLeadSuit) {
            return card.suit === leadSuit;
        }
        
        // If player has no cards of lead suit, any card can be played
        return true;
    });

    // If no valid cards (shouldn't happen due to validation), return first card
    if (validCards.length === 0) {
        console.error('No valid cards found - this should not happen. Returning first card as fallback.');
        return hand[0];
    }

    // If we're leading
    if (!leadSuit) {
        // If we have high point cards, lead them
        const pointCards = validCards.filter(card => card.points > 0);
        if (pointCards.length > 0) {
            return pointCards.reduce((highest, card) => 
                card.number > highest.number ? card : highest
            , pointCards[0]);
        }
        // Otherwise lead lowest non-trump card
        const nonTrumpCards = trump ? validCards.filter(card => card.suit !== trump) : validCards;
        if (nonTrumpCards.length > 0) {
            return nonTrumpCards.reduce((lowest, card) =>
                card.number < lowest.number ? card : lowest
            , nonTrumpCards[0]);
        }
        // If we only have trump cards, lead lowest
        return validCards.reduce((lowest, card) =>
            card.number < lowest.number ? card : lowest
        , validCards[0]);
    }

    // Following suit
    const followSuitCards = validCards.filter(card => card.suit === leadSuit);
    if (followSuitCards.length > 0) {
        // Play highest card of lead suit if we have points
        const highCards = followSuitCards.filter(card => card.points > 0);
        if (highCards.length > 0) {
            return highCards.reduce((highest, card) => 
                card.number > highest.number ? card : highest
            , highCards[0]);
        }
        // Otherwise play lowest card of lead suit
        return followSuitCards.reduce((lowest, card) =>
            card.number < lowest.number ? card : lowest
        , followSuitCards[0]);
    }

    // If we can't follow suit and have trump
    if (trump) {
        const trumpCards = validCards.filter(card => card.suit === trump);
        if (trumpCards.length > 0) {
            // Check if anyone else has played trump
            const trumpPlayed = playedCards.some(card => card.suit === trump);
            if (trumpPlayed) {
                // If trump already played, only play higher trump if we can win
                const highestTrumpPlayed = Math.max(
                    ...playedCards
                        .filter(card => card.suit === trump)
                        .map(card => card.number)
                );
                const winningTrumps = trumpCards.filter(card => card.number > highestTrumpPlayed);
                if (winningTrumps.length > 0) {
                    // Play lowest winning trump
                    return winningTrumps.reduce((lowest, card) =>
                        card.number < lowest.number ? card : lowest
                    , winningTrumps[0]);
                }
            }
            // If no trump played yet or we can't win, play lowest trump
            return trumpCards.reduce((lowest, card) =>
                card.number < lowest.number ? card : lowest
            , trumpCards[0]);
        }
    }

    // If we can't follow suit and have no trump (or don't want to use trump)
    // Play our lowest point card
    return validCards.reduce((lowest, card) =>
        card.points < lowest.points || (card.points === lowest.points && card.number < lowest.number)
            ? card
            : lowest
    , validCards[0]);
}; 