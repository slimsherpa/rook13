import { Card, Player, Seat, Suit, VALID_BIDS } from '../types/game';
import { calculatePoints } from './cardUtils';

// Enhanced bot bidding strategy based on hand strength and partner's actions
export const decideBotBid = (
    hand: Card[],
    currentBid: number | undefined,
    passes: number,
    currentTurn: Seat,
    dealer: Seat,
    players: Record<Seat, Player | null>,
    previousBids: Record<Seat, number | 'pass'>
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

    // Find our partner's seat
    const seats: Seat[] = ['A1', 'B1', 'A2', 'B2'];
    const currentIndex = seats.indexOf(currentTurn);
    if (currentIndex === -1) return 'pass'; // Safety check for invalid current turn
    
    const partnerSeat = seats[(currentIndex + 2) % 4];
    const rightOpponentSeat = seats[(currentIndex + 3) % 4];

    // Consider partner's bid with safety checks
    const partnerBid = previousBids && partnerSeat ? previousBids[partnerSeat] : undefined;
    if (partnerBid && typeof partnerBid === 'number' && partnerBid > 80) {
        // Partner bid high, increase our confidence if we have a strong hand
        handStrength += 10;
    }

    // Consider position relative to dealer
    const dealerIndex = seats.indexOf(dealer);
    const ourIndex = seats.indexOf(currentTurn);
    const positionAfterDealer = (ourIndex - dealerIndex + 4) % 4;

    // If right opponent is leading, be more cautious
    if (rightOpponentSeat === dealer) {
        handStrength -= 5;
    }

    // If we're leading, be more aggressive
    if (dealer === currentTurn) {
        handStrength += 5;
    }

    // If current bid is too high for our hand strength, pass
    if (currentBid) {
        const bidTooHigh = currentBid > (handStrength * 0.85);
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

// Enhanced bot trump selection strategy
export const decideBotTrump = (hand: Card[]): Suit => {
    // Count cards and points of each suit
    const suitInfo = hand.reduce((info, card) => {
        if (!info[card.suit]) {
            info[card.suit] = { count: 0, points: 0, highCards: 0 };
        }
        info[card.suit].count++;
        info[card.suit].points += card.points;
        if (card.number >= 10) info[card.suit].highCards++;
        return info;
    }, {} as Record<Suit, { count: number; points: number; highCards: number }>);
    
    // Find suit with best combination of length and strength
    let bestSuit: Suit = 'Red';
    let bestScore = -1;
    
    Object.entries(suitInfo).forEach(([suit, info]) => {
        const score = (info.count * 10) + (info.points * 2) + (info.highCards * 3);
        if (score > bestScore) {
            bestScore = score;
            bestSuit = suit as Suit;
        }
    });
    
    return bestSuit;
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