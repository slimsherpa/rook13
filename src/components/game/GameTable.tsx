'use client';

import { useEffect, useState } from 'react';
import { useGameStore } from '@/lib/store/gameStore';
import { Seat, VALID_BIDS, Suit, Card as CardType, GameState, Player } from '@/lib/types/game';
import { decideBotBid, decideBotTrump, decideBotCard } from '@/lib/utils/botUtils';
import { determineTrickWinner, calculatePoints } from '@/lib/utils/cardUtils';
import { getNextSeat } from '@/lib/utils/seatUtils';
import Card from './Card';
import TrickDisplay from './TrickDisplay';
import LastTrickDisplay from './LastTrickDisplay';
import HandRecap from './HandRecap';
import ScoreCard from './ScoreCard';
import { useGameUI } from '@/lib/hooks/useGameUI';

// Add new type for trick state
type TrickState = {
    cards: Record<Seat, CardType | null>;
    isComplete: boolean;
    winner: Seat | null;
};

// Add new type for completed trick
type CompletedTrick = {
    cards: Record<Seat, CardType>;
    playOrder: Seat[];
    winner: Seat;
    handScores?: {
        A: number;
        B: number;
    };
};

// Define a type for dragged card
type DraggedCardInfo = {
    index: number;
    card: CardType;
};

// Add new player name positions - bring them closer to center
const playerNamePositions: Record<Seat, string> = {
    'A1': 'absolute bottom-[30px] left-1/2 -translate-x-1/2',
    'B1': 'absolute left-[-20px] top-1/2 -translate-y-1/2 -rotate-90',
    'A2': 'absolute top-[30px] left-1/2 -translate-x-1/2',
    'B2': 'absolute right-[-30px] top-1/2 -translate-y-1/2 rotate-90',
};

// Update dealer indicator positions to be near player names
const dealerIndicatorPositions: Record<Seat, string> = {
    'A1': 'absolute -right-[1px] top-50 -translate-y-1/2',
    'B1': 'absolute -bottom-[-50px] left-50 -translate-x-1/2 -rotate-90',
    'A2': 'absolute -left-[25px] top-5 -translate-y-1/2',
    'B2': 'absolute -bottom-[-50px] left-50 -translate-x-1/2 rotate-90',
};

// Add new bid chip positions during bidding
const bidChipPositions: Record<Seat, string> = {
    'A1': 'absolute bottom-[40px] left-1/2 -translate-x-1/2',
    'B1': 'absolute left-[40px] top-1/2 -translate-y-1/2',
    'A2': 'absolute top-[40px] left-1/2 -translate-x-1/2',
    'B2': 'absolute right-[40px] top-1/2 -translate-y-1/2',
};

// Add new bid chip positions after bid is won
const finalBidChipPositions: Record<Seat, string> = {
    'A1': 'absolute bottom-[20px] left-1/2 -translate-x-1/2',
    'B1': 'absolute left-[20px] top-1/2 -translate-y-1/2',
    'A2': 'absolute top-[20px] left-1/2 -translate-x-1/2',
    'B2': 'absolute right-[20px] top-1/2 -translate-y-1/2',
};

// Add new type for hand scores
interface HandScore {
    dealer: Seat;
    bidWinner: Seat;
    bid: number;
    teamAScore: number;
    teamBScore: number;
    teamATotal: number;
    teamBTotal: number;
}

export default function GameTable() {
    const { 
        game, 
        placeBid, 
        selectGoDown, 
        selectTrump, 
        playCard: playCardAction,
        clearTrick,
        updatePlayerHand,
        startNextHandWithNewDealer,
        startNewHand,
    } = useGameStore();

    const gameUI = useGameUI(game);

    // Early return if no game
    if (!game || !gameUI) return null;

    // Move all game state checks to the top
    const currentPlayer = game.currentTurn ? game.players[game.currentTurn] : null;
    const isHumanTurn = currentPlayer?.type === 'human';
    const isHumanDealer = game.dealer ? game.players[game.dealer]?.type === 'human' : false;

    // Move all useState hooks to the top level
    const [isScoreCardOpen, setIsScoreCardOpen] = useState(false);
    const [isHandRecapOpen, setIsHandRecapOpen] = useState(false);
    const [selectedGoDownCards, setSelectedGoDownCards] = useState<CardType[]>([]);
    const [completedTricks, setCompletedTricks] = useState<CompletedTrick[]>([]);
    const [lastTrick, setLastTrick] = useState<CompletedTrick | null>(null);
    const [handScores, setHandScores] = useState<HandScore[]>([]);
    const [draggedCardIndex, setDraggedCardIndex] = useState<number | null>(null);
    const [draggedCard, setDraggedCard] = useState<DraggedCardInfo | null>(null);
    const [showLastTrick, setShowLastTrick] = useState(false);
    const [showGoDown, setShowGoDown] = useState(false);
    const [showHandRecap, setShowHandRecap] = useState(false);
    const [isDealing, setIsDealing] = useState(false);
    const [dealtSeats, setDealtSeats] = useState<Set<Seat>>(new Set());
    const [selectedWidowCards, setSelectedWidowCards] = useState<CardType[]>([]);
    const [isGoDownFlipped, setIsGoDownFlipped] = useState(false);
    const [showScoreCard, setShowScoreCard] = useState(false);
    
    // Initialize other state variables even if they might not be used
    const [humanSeat] = useState<Seat>('A1');
    const [humanPlayer, setHumanPlayer] = useState<Player | null>(null);

    // Bot turn handling effect
    const isBotTurn = game && game.currentTurn && currentPlayer && currentPlayer.type === 'bot' && !game.trickComplete;
    
    const handleTrickComplete = (cards: Record<Seat, CardType>, winner: Seat) => {
        // Calculate points from this trick
        const trickPoints = calculatePoints(Object.values(cards));
        
        // Add points to the winning team's score
        const winningTeam = winner.charAt(0) as 'A' | 'B';
        const updatedHandScores = {
            A: (lastTrick?.handScores?.A || 0) + (winningTeam === 'A' ? trickPoints : 0),
            B: (lastTrick?.handScores?.B || 0) + (winningTeam === 'B' ? trickPoints : 0)
        };

        // Save the completed trick
        const newCompletedTricks = [...completedTricks, {
            cards,
            playOrder: game?.playOrder || [],
            winner,
            handScores: updatedHandScores
        }];
        setCompletedTricks(newCompletedTricks);

        // Update last trick display
        setLastTrick({ 
            cards, 
            winner,
            handScores: updatedHandScores,
            playOrder: game?.playOrder || []
        });
        
        // Show the last trick display and keep it visible until the hand is completed
        setShowLastTrick(true);
        
        // Show hand recap if this was the 9th trick
        if (newCompletedTricks.length === 9) {
            setShowHandRecap(true);
        }

        clearTrick(winner);
    };

    const handleDealCards = async () => {
        if (!game || game.phase !== 'dealing' || game.currentTurn !== game.dealer) return;
        
        const dealer = game.players[game.dealer!];
        if (!dealer) return;
        
        setIsDealing(true);
        setDealtSeats(new Set());
        
        // Reset all state for new hand
        setSelectedWidowCards([]);
        setDraggedCard(null);
        setLastTrick({
            cards: { 
                A1: { suit: 'Black', number: 0, points: 0 } as CardType, 
                B1: { suit: 'Black', number: 0, points: 0 } as CardType, 
                A2: { suit: 'Black', number: 0, points: 0 } as CardType, 
                B2: { suit: 'Black', number: 0, points: 0 } as CardType 
            },
            winner: 'A1',
            handScores: { A: 0, B: 0 },
            playOrder: ['A1', 'B1', 'A2', 'B2']
        });
        setCompletedTricks([]);
        setShowHandRecap(false);
        setIsGoDownFlipped(false);
        
        // Deal to each seat in clockwise order, starting after the dealer
        const dealOrder: Seat[] = ['A1', 'B1', 'A2', 'B2'];
        const startIdx = dealOrder.indexOf(game.dealer!);
        const orderedSeats = [
            ...dealOrder.slice((startIdx + 1) % 4),
            ...dealOrder.slice(0, (startIdx + 1) % 4)
        ];

        // Deal to each player with a delay
        for (const seat of orderedSeats) {
            await new Promise(resolve => setTimeout(resolve, 200));
            setDealtSeats(prev => new Set([...Array.from(prev), seat]));
        }

        // Small delay before starting the game
        await new Promise(resolve => setTimeout(resolve, 300));
        startNewHand(); // This will deal cards and move to bidding phase
        setIsDealing(false);
    };
    
    useEffect(() => {
        if (!isBotTurn) return;

        // Add a small delay to make bot moves feel more natural
        const timer = setTimeout(async () => {
            // Recheck conditions in case they changed during the timeout
            if (!game || !game.currentTurn || !currentPlayer || currentPlayer.type !== 'bot' || game.trickComplete) return;

            // Check if all players have played all their cards
            const allCardsPlayed = Object.values(game.players).every(p => !p?.hand || p.hand.length === 0);
            if (allCardsPlayed && game.phase === 'playing') {
                setShowHandRecap(true);
                return;
            }
            
            switch (game.phase) {
                case 'dealing': {
                    // If bot is dealer, handle dealing with animation
                    if (game.currentTurn === game.dealer) {
                        await handleDealCards();
                    }
                    break;
                }
                case 'bidding': {
                    if (!currentPlayer.hand) return; // Need hand for bidding
                    // Count passes
                    const passes = Object.values(game.players).filter(
                        (p) => p?.bid === 'pass'
                    ).length;

                    const botBid = decideBotBid(
                        currentPlayer.hand,
                        game.currentBid,
                        passes
                    );
                    placeBid(game.currentTurn!, botBid);
                    break;
                }
                case 'widow': {
                    if (!currentPlayer.hand) return; // Need hand for widow selection
                    // Bot selects lowest 4 cards for go-down
                    const sortedHand = [...currentPlayer.hand].sort((a, b) => 
                        (a.points === b.points) ? a.number - b.number : a.points - b.points
                    );
                    selectGoDown(sortedHand.slice(0, 4));
                    break;
                }
                case 'trump': {
                    if (!currentPlayer.hand) return; // Need hand for trump selection
                    const trumpSuit = decideBotTrump(currentPlayer.hand);
                    selectTrump(trumpSuit);
                    break;
                }
                case 'playing': {
                    if (!currentPlayer.hand || currentPlayer.hand.length === 0) return; // Need cards to play
                    // Get lead suit from played cards
                    const trickCards = game.trickCards || {
                        A1: null,
                        B1: null,
                        A2: null,
                        B2: null,
                    };
                    
                    // Get lead suit from the first card played in the trick
                    const leadSeat = game.playOrder?.[0];
                    const leadCard = leadSeat ? trickCards[leadSeat] : null;
                    const leadSuit = leadCard?.suit || null;

                    // Get played cards for this trick
                    const playedCards = Object.values(trickCards)
                        .filter((c): c is CardType => c !== null);

                    // Try to play cards until one works
                    let remainingCards = [...currentPlayer.hand];
                    let cardToPlay: CardType;
                    while (remainingCards.length > 0) {
                        try {
                            cardToPlay = decideBotCard(
                                remainingCards,
                                leadSuit,
                                game.trump || null,
                                playedCards
                            );
                            playCardAction(game.currentTurn!, cardToPlay);
                            break; // If successful, exit the loop
                        } catch (error) {
                            console.log('Failed to play card, trying another one');
                            // Remove the failed card from remaining options
                            remainingCards = remainingCards.filter(c => 
                                !(c.suit === cardToPlay.suit && c.number === cardToPlay.number)
                            );
                        }
                    }
                    break;
                }
            }
        }, 1000);

        return () => clearTimeout(timer);
    }, [game?.currentTurn, game?.phase, game?.trickCards]);

    // Hand recap effect
    const shouldCalculateHandRecap = game && showHandRecap && game.bidWinner && game.currentBid && game.dealer;
    
    useEffect(() => {
        if (!shouldCalculateHandRecap) return;

        const dealer = game.dealer!;
        const bidWinner = game.bidWinner!;
        const currentBid = game.currentBid!;

        // Calculate team points
        const teamPoints = completedTricks.reduce((acc, trick) => {
            const winningTeam = trick.winner.charAt(0) as 'A' | 'B';
            const trickPoints = calculatePoints(Object.values(trick.cards));
            acc[winningTeam] += trickPoints;
            return acc;
        }, { A: 0, B: 0 });

        // Add go-down points to the team that won the last trick
        if (completedTricks.length > 0) {
            const lastTrickWinner = completedTricks[completedTricks.length - 1].winner;
            const winningTeam = lastTrickWinner.charAt(0) as 'A' | 'B';
            teamPoints[winningTeam] += calculatePoints(game.goDown || []);
        }

        // Count tricks won by each team
        const trickCounts = completedTricks.reduce((acc, trick) => {
            const winningTeam = trick.winner.charAt(0) as 'A' | 'B';
            acc[winningTeam]++;
            return acc;
        }, { A: 0, B: 0 });

        // Add 20 point bonus for taking 5 or more tricks
        if (trickCounts.A >= 5) teamPoints.A += 20;
        if (trickCounts.B >= 5) teamPoints.B += 20;

        // Determine if bid winner made their bid
        const bidWinnerTeam = bidWinner.charAt(0) as 'A' | 'B';
        const bidWinnerPoints = teamPoints[bidWinnerTeam];
        const handScore = bidWinnerPoints >= currentBid ? bidWinnerPoints : -currentBid;

        setHandScores(prev => {
            // Check if we already have a score for this hand
            if (prev.some(score => 
                score.dealer === dealer && 
                score.bidWinner === bidWinner && 
                score.bid === currentBid
            )) {
                return prev;
            }

            // Calculate team scores
            const teamAScore = bidWinnerTeam === 'A' ? handScore : teamPoints.A;
            const teamBScore = bidWinnerTeam === 'B' ? handScore : teamPoints.B;

            // Get previous totals
            const prevTotals = prev.length > 0 
                ? { 
                    A: prev[prev.length - 1].teamATotal, 
                    B: prev[prev.length - 1].teamBTotal 
                } 
                : { A: 0, B: 0 };

            // Create new hand score
            const newScore: HandScore = {
                dealer,
                bidWinner,
                bid: currentBid,
                teamAScore,
                teamBScore,
                teamATotal: prevTotals.A + teamAScore,
                teamBTotal: prevTotals.B + teamBScore
            };

            return [...prev, newScore];
        });
    }, [showHandRecap, game?.bidWinner, game?.currentBid, game?.dealer, game?.goDown, completedTricks]);

    // Last trick update effect
    // Check if completedTricks exists and has items
    const hasCompletedTricks = completedTricks && completedTricks.length > 0;
    
    useEffect(() => {
        if (!hasCompletedTricks) return;
        
        // Use the completedTricks array instead of game.tricks
        const currentTrick = completedTricks[completedTricks.length - 1];
        
        if (currentTrick) {
            setLastTrick({
                cards: currentTrick.cards || { A1: null, B1: null, A2: null, B2: null },
                winner: currentTrick.winner || null,
                handScores: currentTrick.handScores || { A: 0, B: 0 },
                playOrder: currentTrick.playOrder || []
            });
        }
    }, [showHandRecap, game?.bidWinner, game?.currentBid, game?.dealer, game?.goDown, completedTricks]);

    // Trick completion effect
    const hasCompletedTrick = game?.trickComplete && game.trickWinner && game.trickCards;
    
    useEffect(() => {
        if (!hasCompletedTrick) return;
        
        // Cast is safe because we know all cards are played when trick is complete
        const cards = game.trickCards as Record<Seat, CardType>;
        
        // Set a timeout to handle the trick completion after 3 seconds
        const timer = setTimeout(() => {
            handleTrickComplete(cards, game.trickWinner!);
        }, 3000);

        // Cleanup timeout if component unmounts or game state changes
        return () => clearTimeout(timer);
    }, [game?.trickComplete, game?.trickWinner, game?.trickCards]);

    const handleWidowCardSelect = (card: CardType) => {
        if (selectedWidowCards.some(c => c.suit === card.suit && c.number === card.number)) {
            setSelectedWidowCards(selectedWidowCards.filter(
                c => !(c.suit === card.suit && c.number === card.number)
            ));
        } else if (selectedWidowCards.length < 4) {
            setSelectedWidowCards([...selectedWidowCards, card]);
        }
    };

    const handlePlayCard = (seat: Seat, card: CardType) => {
        if (!game) return;
        playCardAction(seat, card);
    };

    const handleDragStart = (index: number, card: CardType) => {
        setDraggedCard({ index, card });
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const handleDrop = (targetIndex: number, seat: Seat) => {
        if (!draggedCard || !game?.players[seat]?.hand) return;
        
        const newHand = [...game.players[seat].hand];
        const sourceIndex = draggedCard.index;
        
        // Remove the card from its original position
        newHand.splice(sourceIndex, 1);
        // Insert it at the new position
        newHand.splice(targetIndex, 0, draggedCard.card);
        
        // Update the hand in the game state
        updatePlayerHand(seat, newHand);
        setDraggedCard(null);
    };

    const renderPlayedCard = (seat: Seat, card: CardType) => {
        const positions = {
            'A1': 'absolute bottom-[34%] left-[46.8%]',
            'B1': 'absolute left-[36%] top-[45%]',
            'A2': 'absolute top-[34%] left-[46.8%]',
            'B2': 'absolute right-[36%] top-[45%]'
        };

        const isWinningCard = game?.trickComplete && game?.trickWinner === seat;

        return (
            <div
                key={`${seat}-${card.suit}-${card.number}`}
                className={`
                    absolute ${positions[seat]}
                    ${seat === 'B1' ? '-rotate-90' :
                      seat === 'A2' ? 'rotate-180' :
                      seat === 'B2' ? 'rotate-90' : ''}
                    transition-all duration-300
                    z-20 scale-[0.8]
                `}
            >
                <Card card={card} highlight={isWinningCard} />
            </div>
        );
    };

    const renderPlayerHand = (seat: Seat) => {
        const player = game?.players[seat];
        if (!player?.hand || !game) return null;

        // Don't show any cards if we haven't dealt yet
        if (game.phase === 'dealing' && !dealtSeats.has(seat)) {
            return null;
        }

        const isCurrentPlayer = seat === game?.currentTurn;
        const isHumanPlayer = player.type === 'human';
        // Only show face up cards if it's the human player's hand
        const isFaceUp = isHumanPlayer;
        const isWidowPhase = game?.phase === 'widow' && isCurrentPlayer && isHumanTurn;

        // Get lead suit from played cards
        const trickCards = game?.trickCards || {
            A1: null,
            B1: null,
            A2: null,
            B2: null
        };
        
        // Get lead suit from the first card played in the trick
        const leadSeat = game?.playOrder?.[0];
        const leadCard = leadSeat ? trickCards[leadSeat] : null;
        const leadSuit = leadCard?.suit || null;

        // Check if a card from this player is in the current trick
        const playedCard = trickCards[seat];

        return (
            <div className="space-y-2">
                {/* Cards */}
                <div className="flex gap-2 p-4 relative justify-center">
                    {player.hand.map((card, index) => {
                        const isPlayed = playedCard && 
                            playedCard.suit === card.suit && 
                            playedCard.number === card.number;

                        // Determine if this card can be played
                        const canPlay = !leadSuit || // First card of trick
                                      card.suit === leadSuit || // Following suit
                                      !player.hand?.some(c => c.suit === leadSuit);

                        return (
                            <div
                                key={`${card.suit}-${card.number}`}
                                className={`
                                    transition-all duration-200
                                    ${isPlayed ? 'opacity-0' : 'opacity-100'}
                                    ${isHumanPlayer ? 'cursor-grab active:cursor-grabbing' : ''}
                                    ${draggedCard?.card === card ? 'opacity-50' : ''}
                                    relative
                                `}
                                draggable={isHumanPlayer}
                                onDragStart={(e) => {
                                    handleDragStart(index, card);
                                }}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'move';
                                    
                                    // Clear all existing highlights
                                    const cards = e.currentTarget.parentElement?.children;
                                    if (cards) {
                                        Array.from(cards).forEach((card) => {
                                            card.classList.remove('border-blue-400');
                                        });
                                    }

                                    // Show a simple highlight on the drop target
                                    e.currentTarget.classList.add('border-blue-400');
                                }}
                                onDragLeave={(e) => {
                                    e.currentTarget.classList.remove('border-blue-400');
                                }}
                                onDragEnd={(e) => {
                                    // Clear all highlights
                                    const cards = e.currentTarget.parentElement?.children;
                                    if (cards) {
                                        Array.from(cards).forEach((card) => {
                                            card.classList.remove('border-blue-400');
                                        });
                                    }
                                    setDraggedCard(null);
                                }}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    e.currentTarget.classList.remove('border-blue-400');
                                    
                                    // Simple drop logic - always drop at the target index
                                    handleDrop(index, seat);
                                }}
                            >
                                <Card
                                    card={isFaceUp ? card : { suit: 'Black', number: 0, points: 0 }}
                                    onClick={
                                        isWidowPhase
                                            ? () => handleWidowCardSelect(card)
                                            : isCurrentPlayer && isHumanTurn && game?.phase === 'playing' && canPlay
                                            ? () => handlePlayCard(seat, card)
                                            : undefined
                                    }
                                    disabled={!isCurrentPlayer || !isHumanTurn || 
                                            (game?.phase !== 'playing' && game?.phase !== 'widow') ||
                                            (game?.phase === 'playing' && !canPlay)}
                                    selected={isWidowPhase && selectedWidowCards.some(
                                        c => c.suit === card.suit && c.number === card.number
                                    )}
                                    selectable={isWidowPhase && selectedWidowCards.length < 4}
                                    dimmed={isCurrentPlayer && game?.phase === 'playing' && !canPlay}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    // Add the Deal Cards button UI
    const renderDealButton = () => {
        if (!gameUI.canShowDealButton) return null;

        console.log('Rendering deal button:', {
            phase: gameUI.phase,
            currentTurn: gameUI.currentTurn,
            dealer: gameUI.dealer,
            canShow: gameUI.canShowDealButton
        });

        return (
            <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50">
                <button
                    onClick={handleDealCards}
                    className="px-8 py-4 bg-green-600 text-white rounded-xl font-orbitron 
                             shadow-lg transition-colors flex items-center gap-3 text-xl
                             hover:bg-green-700"
                >
                    <span className="material-symbols-outlined text-3xl">style</span>
                    Deal Cards
                </button>
            </div>
        );
    };

    // Render bidding UI only if we're in bidding phase and it's a human's turn
    const renderBiddingUI = () => {
        if (!gameUI.canShowBiddingUI) return null;

        console.log('Rendering bidding UI:', {
            phase: gameUI.phase,
            currentTurn: gameUI.currentTurn,
            isHumanTurn: gameUI.isHumanTurn,
            canShow: gameUI.canShowBiddingUI
        });

        const minBid = game.currentBid ? game.currentBid + 5 : 65;

        return (
            <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50 bg-white p-4 rounded-lg shadow-lg">
                <div className="flex gap-2">
                    <button
                        onClick={() => placeBid(game.currentTurn!, 'pass')}
                        className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                    >
                        Pass
                    </button>
                    {VALID_BIDS.filter(bid => bid >= minBid).map(bid => (
                        <button
                            key={bid}
                            onClick={() => placeBid(game.currentTurn!, bid)}
                            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                        >
                            {bid}
                        </button>
                    ))}
                </div>
            </div>
        );
    };

    // Render trump selection UI only if we're in trump phase and it's a human's turn
    const renderTrumpUI = () => {
        if (game.phase !== 'trump' || !isHumanTurn) return null;

        const suits: Suit[] = ['Red', 'Yellow', 'Black', 'Green'];
        
        return (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-white p-6 rounded-lg shadow-lg pointer-events-auto">
                    <h3 className="text-lg font-semibold mb-2">Select Trump Suit</h3>
                    <div className="flex gap-2">
                        {suits.map(suit => (
                            <button
                                key={suit}
                                onClick={() => selectTrump(suit)}
                                className={`px-4 py-2 rounded text-white
                                    ${suit === 'Red' ? 'bg-red-600 hover:bg-red-700' :
                                      suit === 'Yellow' ? 'bg-yellow-600 hover:bg-yellow-700' :
                                      suit === 'Black' ? 'bg-gray-800 hover:bg-gray-900' :
                                      'bg-green-600 hover:bg-green-700'}`}
                            >
                                {suit}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    // Render phase-specific UI
    const renderPhaseUI = () => {
        switch (game.phase) {
            case 'bidding':
                return renderBiddingUI();
            case 'widow':
                if (gameUI.isHumanTurn) {
                    return (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="bg-white p-6 rounded-lg shadow-lg pointer-events-auto">
                                <h3 className="text-lg font-semibold mb-2">Select 4 Cards for Go-Down</h3>
                                <p className="text-sm text-gray-600 mb-4">
                                    Selected: {selectedWidowCards.length}/4 cards
                                </p>
                                <button
                                    onClick={() => {
                                        if (selectedWidowCards.length === 4) {
                                            selectGoDown(selectedWidowCards);
                                            setSelectedWidowCards([]);
                                        }
                                    }}
                                    disabled={selectedWidowCards.length !== 4}
                                    className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                                >
                                    Confirm Selection
                                </button>
                            </div>
                        </div>
                    );
                }
                return null;
            case 'trump':
                return renderTrumpUI();
            default:
                return null;
        }
    };

    // Update the renderGoDown function
    const renderGoDown = () => {
        if (!game?.goDown) return null;

        // Check if the current human player is the one who put down the cards
        const isHumanBidWinner = game.bidWinner && game.players[game.bidWinner]?.type === 'human';

        return (
            <div 
                className="fixed bottom-8 right-8 z-30"
                onClick={() => isHumanBidWinner && handleGoDownClick()}
            >
                <div className={`
                    flex flex-col items-end gap-2 
                    ${isHumanBidWinner ? 'cursor-pointer' : ''}
                `}>
                    {/* Label */}
                    <div className="text-white/80 font-orbitron text-sm px-2">
                        Go Down Cards
                    </div>
                    {/* Cards */}
                    <div className="flex gap-1">
                        {game.goDown.map((card, index) => (
                            <div
                                key={index}
                                className={`
                                    transform scale-[0.85] origin-top-right
                                    transition-all duration-300
                                    ${isHumanBidWinner ? 'hover:-translate-y-2' : ''}
                                `}
                            >
                                <Card
                                    card={isGoDownFlipped ? card : { suit: 'Black', number: 0, points: 0 }}
                                    disabled={true}
                                    selectable={isHumanBidWinner}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    // Update the handleGoDownClick function
    const handleGoDownClick = () => {
        if (!game?.goDown) return;
        
        setIsGoDownFlipped(true);
        // Auto-flip back after 2 seconds
        setTimeout(() => setIsGoDownFlipped(false), 2000);
    };

    const handleStartNextHand = () => {
        console.log('Starting next hand...');
        setShowHandRecap(false);
        setShowLastTrick(false);
        
        // Call startNextHandWithNewDealer directly instead of setting readyForNextHand
        startNextHandWithNewDealer();
        
        // Reset local state
        setCompletedTricks([]);
        setLastTrick({
            cards: { 
                A1: { suit: 'Black', number: 0, points: 0 } as CardType, 
                B1: { suit: 'Black', number: 0, points: 0 } as CardType, 
                A2: { suit: 'Black', number: 0, points: 0 } as CardType, 
                B2: { suit: 'Black', number: 0, points: 0 } as CardType 
            },
            winner: 'A1',
            handScores: { A: 0, B: 0 },
            playOrder: ['A1', 'B1', 'A2', 'B2']
        });
    };

    // Add secret card sorting function
    const handleSecretSort = () => {
        if (!game?.players?.A1?.hand) return;

        // Group cards by suit
        const cardsBySuit = game.players.A1.hand.reduce((acc, card) => {
            if (!acc[card.suit]) acc[card.suit] = [];
            acc[card.suit].push(card);
            return acc;
        }, {} as Record<Suit, CardType[]>);

        // Sort each suit by number (descending)
        Object.values(cardsBySuit).forEach(cards => {
            cards.sort((a, b) => b.number - a.number);
        });

        // Sort suits by length (descending)
        const sortedSuits = Object.entries(cardsBySuit)
            .sort(([, cardsA], [, cardsB]) => cardsB.length - cardsA.length);

        // Flatten the sorted cards
        const sortedHand = sortedSuits.flatMap(([, cards]) => cards);

        // Update the player's hand
        updatePlayerHand('A1', sortedHand);
    };

    return (
        <div className="h-screen w-screen overflow-hidden bg-green-800">
            {/* ROOK title and game info - now fixed */}
            <div className="fixed top-0 left-0 p-8 space-y-4 z-40">
                {/* ROOK title - add click handler */}
                <div 
                    onClick={handleSecretSort}
                    className="font-orbitron text-[48px] font-bold text-white cursor-pointer hover:text-white/90 transition-colors"
                >
                    ROOK
                </div>

                {/* Game info - now clickable */}
                <div 
                    onClick={() => setShowScoreCard(true)}
                    className="text-white cursor-pointer hover:text-white/90 transition-colors font-orbitron"
                >
                    <div className="text-2xl">Score:</div>
                    <div className="text-xl">
                        Team A: {handScores.length > 0 ? handScores[handScores.length - 1].teamATotal : 0}
                    </div>
                    <div className="text-xl">
                        Team B: {handScores.length > 0 ? handScores[handScores.length - 1].teamBTotal : 0}
                    </div>
                </div>
            </div>

            {/* Score Card */}
            <ScoreCard
                isOpen={showScoreCard}
                onClose={() => setShowScoreCard(false)}
                game={game}
                handScores={handScores}
            />

            {/* Hand Recap */}
            {showHandRecap && game.goDown && (
                <HandRecap
                    isOpen={showHandRecap}
                    onClose={handleStartNextHand}
                    tricks={completedTricks}
                    goDown={game.goDown}
                    players={game.players}
                    bidWinner={game.bidWinner!}
                    currentBid={game.currentBid!}
                />
            )}

            {/* Last trick display */}
            {lastTrick && showLastTrick && (
                <LastTrickDisplay 
                    lastTrick={lastTrick.cards}
                    winner={lastTrick.winner}
                    players={game.players}
                    tricks={game.tricks}
                    handScores={lastTrick.handScores || { A: 0, B: 0 }}
                    playOrder={lastTrick.playOrder}
                />
            )}

            {/* Game table */}
            <div className="h-full w-full flex items-center justify-center">
                <div className="relative w-full max-w-[1000px] aspect-square flex items-center justify-center mx-auto">
                    {/* Dark green circle */}
                    <div className="absolute w-[50%] aspect-square rounded-full bg-green-900 z-0">
                        {/* Turn Indicators - one for each position */}
                        <div className="absolute top-[-60px] left-1/2 -translate-x-1/2">
                            <div className={`
                                w-0 h-0
                                border-l-[60px] border-l-transparent
                                border-r-[60px] border-r-transparent
                                border-b-[90px] border-b-green-900
                                filter drop-shadow-[0_0_15px_rgba(20,83,45,0.5)]
                                transition-opacity duration-300
                                ${game.currentTurn === 'A2' ? 'opacity-100' : 'opacity-0'}
                            `}/>
                        </div>
                        <div className="absolute right-[-75px] top-1/2 -translate-y-1/2">
                            <div className={`
                                w-0 h-0
                                border-l-[60px] border-l-transparent
                                border-r-[60px] border-r-transparent
                                border-b-[90px] border-b-green-900
                                filter drop-shadow-[0_0_15px_rgba(20,83,45,0.5)]
                                transition-opacity duration-300
                                rotate-90
                                ${game.currentTurn === 'B2' ? 'opacity-100' : 'opacity-0'}
                            `}/>
                        </div>
                        <div className="absolute bottom-[-60px] left-1/2 -translate-x-1/2">
                            <div className={`
                                w-0 h-0S
                                border-l-[60px] border-l-transparent
                                border-r-[60px] border-r-transparent
                                border-b-[90px] border-b-green-900
                                filter drop-shadow-[0_0_15px_rgba(20,83,45,0.5)]
                                transition-opacity duration-300
                                rotate-180
                                ${game.currentTurn === 'A1' ? 'opacity-100' : 'opacity-0'}
                            `}/>
                        </div>
                        <div className="absolute left-[-75px] top-1/2 -translate-y-1/2">
                            <div className={`
                                w-0 h-0
                                border-l-[60px] border-l-transparent
                                border-r-[60px] border-r-transparent
                                border-b-[90px] border-b-green-900
                                filter drop-shadow-[0_0_15px_rgba(20,83,45,0.5)]
                                transition-opacity duration-300
                                -rotate-90
                                ${game.currentTurn === 'B1' ? 'opacity-100' : 'opacity-0'}
                            `}/>
                        </div>

                        {/* Bid Chips */}
                        {Object.entries(game.players).map(([seat, player]) => {
                            if (!player?.bid) return null;
                            // Don't show pass bids after bidding phase
                            if (player.bid === 'pass' && game.phase !== 'bidding') return null;
                            
                            const position = game.bidWinner 
                                ? finalBidChipPositions[seat as Seat]
                                : bidChipPositions[seat as Seat];
                            return (
                                <div key={seat} className={`${position}`}>
                                    {player.bid === 'pass' ? (
                                        <div className="px-3 py-1 bg-gray-700/90 backdrop-blur-sm border-2 border-gray-600 rounded-lg">
                                            <div className="font-orbitron font-bold text-gray-300 text-sm">
                                                PASS
                                            </div>
                                        </div>
                                    ) : (
                                        <div className={`
                                            flex items-center justify-center
                                            w-12 h-12 rounded-full
                                            ${game.bidWinner === seat
                                                ? 'bg-blue-600 text-white border-2 border-blue-400'
                                                : 'bg-gray-700 text-gray-200 border-2 border-gray-600'}
                                            font-orbitron font-bold text-lg
                                        `}>
                                            {player.bid}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Player Names with Dealer Indicator */}
                    {Object.entries(game.players).map(([seat, player]) => (
                        player && (
                            <div key={seat} className={`${playerNamePositions[seat as Seat]}`}>
                                <div className={`
                                    relative
                                    text-[48px] font-orbitron font-bold text-green-900
                                    px-4 py-2 rounded-xl
                                `}>
                                    {player.name.split(' ')[0]}
                                    {/* Dealer Indicator */}
                                    {game.dealer === seat && (
                                        <div className={`${dealerIndicatorPositions[seat as Seat]}`}>
                                            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-yellow-500/90 border-4 border-yellow-400/50 shadow-lg">
                                                <span className="material-symbols-outlined text-green-900">
                                                    playing_cards
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )
                    ))}

                    {/* Top player (A2) */}
                    <div className="absolute top-[80px] left-1/2 -translate-x-1/2">
                        <div className="flex flex-col items-center gap-2">
                            <div className="flex gap-1 scale-[0.8]">
                                {renderPlayerHand('A2')}
                            </div>
                        </div>
                    </div>

                    {/* Left player (B1) */}
                    <div className="absolute left-[45px] top-1/2 -translate-y-1/2 w-[20%]">
                        <div className="flex justify-center">
                            <div className="transform -rotate-90 origin-center flex gap-1 scale-[0.8]">
                                {renderPlayerHand('B1')}
                            </div>
                        </div>
                    </div>

                    {/* Right player (B2) */}
                    <div className="absolute right-[45px] top-1/2 -translate-y-1/2 w-[20%]">
                        <div className="flex justify-center">
                            <div className="transform rotate-90 origin-center flex gap-1 scale-[0.8]">
                                {renderPlayerHand('B2')}
                            </div>
                        </div>
                    </div>

                    {/* Bottom player (A1) */}
                    <div className="absolute bottom-[80px] left-1/2 -translate-x-1/2">
                        <div className="flex flex-col items-center gap-2">
                            <div className="flex gap-1 scale-[0.8]">
                                {renderPlayerHand('A1')}
                            </div>
                        </div>
                    </div>

                    {/* Played cards */}
                    {game.trickCards && Object.entries(game.trickCards).map(([seat, card]) => (
                        card && renderPlayedCard(seat as Seat, card)
                    ))}
                    
                    {/* Go Down display */}
                    {renderGoDown()}

                    {/* Start Next Hand Button - Update this section */}
                    {game.phase === 'dealing' && game.currentTurn === game.dealer && (
                        <button
                            onClick={handleDealCards}
                            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 
                                     bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg
                                     shadow-lg transform transition-all duration-200 hover:scale-105 animate-bounce"
                        >
                            Deal Cards
                        </button>
                    )}
                </div>
            </div>

            {/* Render deal button and bidding UI at the bottom of the screen */}
            {renderDealButton()}
            {renderBiddingUI()}
            {renderPhaseUI()}
        </div>
    );
}