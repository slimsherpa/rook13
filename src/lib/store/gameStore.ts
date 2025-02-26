import { create } from 'zustand';
import { GameState, Player, Seat, Card, Suit } from '../types/game';
import { createDeck, dealCards, canPlayCard, determineTrickWinner, calculatePoints } from '../utils/cardUtils';
import { getNextSeat } from '../utils/seatUtils';
import { v4 as uuidv4 } from 'uuid';

interface GameStore {
    game: GameState | null;
    createGame: (humanPlayer: Player) => void;
    addBot: (seat: Seat) => void;
    setPlayerReady: (seat: Seat) => void;
    startNewHand: () => void;
    startNextHandWithNewDealer: () => void;
    placeBid: (seat: Seat, bid: number | 'pass') => void;
    selectGoDown: (cards: Card[]) => void;
    selectTrump: (suit: Suit) => void;
    playCard: (seat: Seat, card: Card) => void;
    clearTrick: (winner: Seat) => void;
    resetGame: () => void;
    updatePlayerHand: (seat: Seat, newHand: Card[]) => void;
}

const createInitialGameState = (humanPlayer: Player): GameState => {
    // Randomly select first dealer
    const seats: Seat[] = ['A1', 'B1', 'A2', 'B2'];
    const firstDealer = seats[Math.floor(Math.random() * seats.length)];
    
    return {
        id: uuidv4(),
        status: 'waiting',
        phase: 'setup', // New phase for initial setup
        players: {
            'A1': { ...humanPlayer, seat: 'A1' },
            'B1': null,
            'A2': null,
            'B2': null,
        },
        tricks: { A: 0, B: 0 },
        scores: { A: 0, B: 0 },
        created: new Date(),
        dealer: firstDealer,
    };
};

const createBot = (seat: Seat): Player => {
    // Custom names for each bot based on seat
    const botNames: Record<Seat, string> = {
        'A1': 'Bot A1', // This shouldn't be used as A1 is the human player
        'B1': 'Lefty',
        'A2': 'Partner',
        'B2': 'Righty'
    };
    
    return {
        id: uuidv4(),
        name: botNames[seat],
        type: 'bot',
        seat,
        ready: true,
    };
};

export const useGameStore = create<GameStore>()((set) => ({
    game: null,
    
    createGame: (humanPlayer: Player) => {
        set({ game: createInitialGameState(humanPlayer) });
    },
    
    addBot: (seat: Seat) => {
        set((state) => {
            if (!state.game) return state;
            
            return {
                game: {
                    ...state.game,
                    players: {
                        ...state.game.players,
                        [seat]: createBot(seat),
                    },
                },
            };
        });
    },
    
    setPlayerReady: (seat: Seat) => {
        set((state) => {
            if (!state.game) return state;
            const player = state.game.players[seat];
            if (!player) return state;
            
            const updatedPlayers = {
                ...state.game.players,
                [seat]: { ...player, ready: true },
            };
            
            // Check if all players are ready
            const allReady = Object.values(updatedPlayers).every(
                (p) => p && p.ready
            );
            
            if (allReady && state.game.status === 'waiting') {
                // Start the game in dealing phase
                const updatedGame: GameState = {
                    ...state.game,
                    status: 'active',
                    phase: 'dealing',
                    players: updatedPlayers,
                    currentTurn: state.game.dealer, // Set dealer as current turn
                };
                
                return { game: updatedGame };
            }
            
            return {
                game: {
                    ...state.game,
                    players: updatedPlayers,
                },
            };
        });
    },
    
    startNewHand: () => {
        set((state) => {
            if (!state.game) return state;
            
            // Create and deal a new deck
            const deck = createDeck();
            const { hands, widow } = dealCards(deck);
            
            // Update game state with dealt cards and move to bidding phase
            return {
                game: {
                    ...state.game,
                    phase: 'bidding',
                    players: Object.entries(state.game.players).reduce<Record<Seat, Player | null>>(
                        (acc, [seat, player]) => ({
                            ...acc,
                            [seat]: player ? {
                                ...player,
                                hand: hands[seat as Seat],
                                bid: undefined,
                            } : null,
                        }),
                        { A1: null, B1: null, A2: null, B2: null }
                    ),
                    currentTurn: getNextSeat(state.game.dealer!), // First bidder is to the left of dealer
                    widow,
                    currentBid: undefined,
                    bidWinner: undefined,
                    trump: undefined,
                    trickCards: {
                        A1: null,
                        B1: null,
                        A2: null,
                        B2: null,
                    },
                    trickWinner: undefined,
                    trickComplete: false,
                    playOrder: [],
                    tricks: { A: 0, B: 0 },
                },
            };
        });
    },
    
    startNextHandWithNewDealer: () => {
        set((state) => {
            if (!state.game) return state;
            
            // Rotate dealer clockwise
            const newDealer = getNextSeat(state.game.dealer!);
            
            return {
                game: {
                    ...state.game,
                    phase: 'dealing', // Set to dealing phase, waiting for dealer to deal
                    dealer: newDealer,
                    currentTurn: newDealer, // Set current turn to dealer so they can deal
                    bidWinner: undefined,
                    currentBid: undefined,
                    trump: undefined,
                    widow: undefined,
                    goDown: undefined,
                    trickCards: {
                        A1: null,
                        B1: null,
                        A2: null,
                        B2: null,
                    },
                    trickWinner: undefined,
                    trickComplete: false,
                    playOrder: [],
                    tricks: { A: 0, B: 0 },
                    players: Object.entries(state.game.players).reduce<Record<Seat, Player | null>>(
                        (acc, [seat, player]) => ({
                            ...acc,
                            [seat]: player ? {
                                ...player,
                                hand: undefined, // Clear hands, will be dealt when dealer deals
                                bid: undefined,
                            } : null,
                        }),
                        { A1: null, B1: null, A2: null, B2: null }
                    ),
                },
            };
        });
    },
    
    placeBid: (seat: Seat, bid: number | 'pass') => {
        set((state) => {
            if (!state.game || state.game.phase !== 'bidding') return state;
            
            const updatedPlayers = {
                ...state.game.players,
                [seat]: state.game.players[seat] ? {
                    ...state.game.players[seat]!,
                    bid,
                } : null,
            };
            
            // Count passes
            const passes = Object.values(updatedPlayers).filter(
                (p) => p?.bid === 'pass'
            ).length;
            
            // Update current bid if not a pass
            const newCurrentBid = bid === 'pass' ? state.game.currentBid : bid;
            
            // Find next bidder
            const nextTurn = getNextSeat(seat);
            
            // If three passes, the last player must bid
            if (passes === 3) {
                const lastBidder = Object.entries(updatedPlayers).find(
                    ([_, p]) => p && p.bid !== 'pass'
                );
                
                if (lastBidder) {
                    const bidWinnerSeat = lastBidder[0] as Seat;
                    const bidWinner = updatedPlayers[bidWinnerSeat]!;
                    
                    // Add widow cards to bid winner's hand
                    const updatedBidWinner = {
                        ...bidWinner,
                        hand: [...(bidWinner.hand || []), ...(state.game.widow || [])],
                    };
                    
                    return {
                        game: {
                            ...state.game,
                            players: {
                                ...updatedPlayers,
                                [bidWinnerSeat]: updatedBidWinner,
                            },
                            phase: 'widow',
                            bidWinner: bidWinnerSeat,
                            currentBid: lastBidder[1]?.bid as number,
                            currentTurn: bidWinnerSeat,
                        },
                    };
                }
            }
            
            return {
                game: {
                    ...state.game,
                    players: updatedPlayers,
                    currentBid: newCurrentBid,
                    currentTurn: nextTurn,
                },
            };
        });
    },
    
    selectGoDown: (cards: Card[]) => {
        set((state) => {
            if (!state.game || state.game.phase !== 'widow' || !state.game.bidWinner) return state;
            
            const bidWinner = state.game.players[state.game.bidWinner];
            if (!bidWinner || !bidWinner.hand) return state;
            
            // Remove selected cards from hand
            const updatedHand = bidWinner.hand.filter(card => 
                !cards.some(c => c.suit === card.suit && c.number === card.number)
            );
            
            return {
                game: {
                    ...state.game,
                    phase: 'trump',
                    players: {
                        ...state.game.players,
                        [state.game.bidWinner]: {
                            ...bidWinner,
                            hand: updatedHand,
                        },
                    },
                    goDown: cards,
                },
            };
        });
    },
    
    selectTrump: (suit: Suit) => {
        set((state) => {
            if (!state.game || state.game.phase !== 'trump') return state;
            
            return {
                game: {
                    ...state.game,
                    phase: 'playing',
                    trump: suit,
                    currentTurn: getNextSeat(state.game.dealer!),
                    trickCards: {
                        A1: null,
                        B1: null,
                        A2: null,
                        B2: null,
                    },
                },
            };
        });
    },
    
    playCard: (seat: Seat, card: Card) => {
        set((state) => {
            if (!state.game || state.game.phase !== 'playing') return state;
            
            const player = state.game.players[seat];
            if (!player?.hand) return state;

            // Validate it's the player's turn
            if (state.game.currentTurn !== seat) {
                console.log('Not your turn');
                return state;
            }

            // Check if player has already played a card in this trick
            if (state.game.trickCards?.[seat] !== null) {
                console.log('Already played a card in this trick');
                return state;
            }

            // Check if it's a legal play
            const leadSeat = state.game.playOrder?.[0];
            const leadCard = leadSeat ? state.game.trickCards?.[leadSeat] : null;
            const leadSuit = leadCard?.suit || null;
            
            if (!canPlayCard(card, leadSuit, player.hand)) {
                console.log('Cannot play this card');
                return state;
            }

            // Verify the card is in the player's hand
            if (!player.hand.some(c => c.suit === card.suit && c.number === card.number)) {
                console.log('Card not in hand');
                return state;
            }

            // Remove card from player's hand
            const updatedHand = player.hand.filter(c => 
                !(c.suit === card.suit && c.number === card.number)
            );

            // Add card to trick and update play order
            const updatedTrickCards = {
                ...(state.game.trickCards || {
                    A1: null,
                    B1: null,
                    A2: null,
                    B2: null,
                }),
                [seat]: card,
            };

            // Update play order
            const updatedPlayOrder = [...(state.game.playOrder || []), seat];

            // Check if trick is complete
            const trickComplete = Object.values(updatedTrickCards).every(c => c !== null);
            
            if (trickComplete) {
                // Get lead suit from first card played in the trick
                const leadSeat = state.game.playOrder?.[0];
                const leadCard = leadSeat ? updatedTrickCards[leadSeat] : null;
                if (!leadCard) return state;

                // Determine trick winner
                const winner = determineTrickWinner(
                    updatedTrickCards as Record<string, Card>,
                    leadCard.suit,
                    state.game.trump || null
                ) as Seat;

                // Calculate points from trick
                const trickPoints = Object.values(updatedTrickCards)
                    .reduce((sum, card) => sum + (card?.points || 0), 0);

                // Update trick counts
                const updatedTricks = {
                    ...state.game.tricks,
                    [winner.charAt(0)]: state.game.tricks[winner.charAt(0) as 'A' | 'B'] + 1,
                };

                // Check if this was the last trick
                const isLastTrick = Object.values(state.game.players)
                    .every(p => p?.hand?.length === 0);

                if (isLastTrick) {
                    // Add go-down points to last trick winner
                    const goDownPoints = calculatePoints(state.game.goDown || []);
                    
                    // Calculate final hand score
                    const bidWinnerTeam = state.game.bidWinner!.charAt(0) as 'A' | 'B';
                    const bidAmount = state.game.currentBid!;
                    
                    // Calculate total points for each team
                    const teamPoints = {
                        A: 0,
                        B: 0,
                    };

                    // Add trick points
                    Object.entries(updatedTrickCards).forEach(([seat, card]) => {
                        if (card) {
                            teamPoints[seat.charAt(0) as 'A' | 'B'] += card.points;
                        }
                    });

                    // Add go-down points to last trick winner's team
                    teamPoints[winner.charAt(0) as 'A' | 'B'] += goDownPoints;

                    // Add trick bonus (20 points for taking 5 or more tricks)
                    if (updatedTricks.A >= 5) teamPoints.A += 20;
                    if (updatedTricks.B >= 5) teamPoints.B += 20;

                    // Determine if bid winner made their bid
                    const bidWinnerPoints = teamPoints[bidWinnerTeam];
                    const handScore = bidWinnerPoints >= bidAmount ? bidWinnerPoints : -bidAmount;

                    // Update game scores
                    const updatedScores = {
                        ...state.game.scores,
                        [bidWinnerTeam]: state.game.scores[bidWinnerTeam] + handScore,
                    };

                    // Check for game end
                    if (updatedScores.A >= 500 || updatedScores.B >= 500 || 
                        updatedScores.A <= -250 || updatedScores.B <= -250) {
                        return {
                            game: {
                                ...state.game,
                                status: 'completed',
                                players: {
                                    ...state.game.players,
                                    [seat]: { ...player, hand: updatedHand },
                                },
                                scores: updatedScores,
                            },
                        };
                    }

                    // Start new hand
                    const newDealer = getNextSeat(state.game.dealer!);
                    const deck = createDeck();
                    const { hands, widow } = dealCards(deck);

                    return {
                        game: {
                            ...state.game,
                            phase: 'dealing', // Start in dealing phase
                            players: Object.entries(state.game.players).reduce<Record<Seat, Player | null>>(
                                (acc, [seat, player]) => ({
                                    ...acc,
                                    [seat]: player ? {
                                        ...player,
                                        hand: hands[seat as Seat],
                                        bid: undefined,
                                    } : null,
                                }),
                                { A1: null, B1: null, A2: null, B2: null }
                            ),
                            dealer: newDealer, // Set new dealer
                            currentTurn: newDealer, // Set current turn to new dealer
                            bidWinner: undefined,
                            currentBid: undefined,
                            trump: undefined,
                            widow: undefined, // Don't deal widow cards yet
                            goDown: undefined,
                            trickCards: {
                                A1: null,
                                B1: null,
                                A2: null,
                                B2: null,
                            },
                            trickWinner: undefined,
                            trickComplete: false,
                            playOrder: [],
                            tricks: { A: 0, B: 0 },
                            scores: updatedScores,
                        },
                    };
                }

                // Mark trick as complete but don't clear cards yet
                return {
                    game: {
                        ...state.game,
                        players: {
                            ...state.game.players,
                            [seat]: { ...player, hand: updatedHand },
                        },
                        currentTurn: winner,
                        trickCards: updatedTrickCards,
                        trickWinner: winner,
                        trickComplete: true,
                        playOrder: updatedPlayOrder,
                        tricks: updatedTricks,
                    },
                };
            }

            // Continue current trick
            return {
                game: {
                    ...state.game,
                    players: {
                        ...state.game.players,
                        [seat]: { ...player, hand: updatedHand },
                    },
                    currentTurn: getNextSeat(seat),
                    trickCards: updatedTrickCards,
                    trickComplete: false,
                    playOrder: updatedPlayOrder,
                },
            };
        });
    },
    
    clearTrick: (winner: Seat) => {
        set((state) => {
            if (!state.game || state.game.phase !== 'playing') return state;

            return {
                game: {
                    ...state.game,
                    currentTurn: winner,
                    trickCards: {
                        A1: null,
                        B1: null,
                        A2: null,
                        B2: null,
                    },
                    trickWinner: undefined,
                    trickComplete: false,
                    playOrder: [], // Reset play order for new trick
                },
            };
        });
    },
    
    resetGame: () => {
        set({ game: null });
    },

    updatePlayerHand: (seat: Seat, newHand: Card[]) => {
        set((state) => {
            if (!state.game) return state;
            
            const player = state.game.players[seat];
            if (!player) return state;
            
            return {
                game: {
                    ...state.game,
                    players: {
                        ...state.game.players,
                        [seat]: {
                            ...player,
                            hand: newHand,
                        },
                    },
                },
            };
        });
    },
})); 