import { useEffect, useState, useRef } from 'react';
import { Card as CardType, Seat, GameState } from '@/lib/types/game';
import { determineTrickWinner } from '@/lib/utils/cardUtils';
import Card from './Card';

interface TrickDisplayProps {
    game: GameState;
    onTrickComplete?: (cards: Record<Seat, CardType>, winner: Seat) => void;
}

type TrickPhase = 
    | { state: 'empty' }
    | { state: 'collecting_cards'; cards: Record<Seat, CardType | null> }
    | { state: 'showing_completed_trick'; cards: Record<Seat, CardType>; winner: Seat }
    | { state: 'clearing' };

export default function TrickDisplay({ game, onTrickComplete }: TrickDisplayProps) {
    const [phase, setPhase] = useState<TrickPhase>({ state: 'empty' });
    const clearTimeoutRef = useRef<NodeJS.Timeout>();

    // Debug logging for phase changes
    useEffect(() => {
        console.log('TrickDisplay phase changed:', phase);
    }, [phase]);

    // Clean up timeouts on unmount
    useEffect(() => {
        return () => {
            if (clearTimeoutRef.current) {
                clearTimeout(clearTimeoutRef.current);
            }
        };
    }, []);

    // Watch for trick card changes and completion
    useEffect(() => {
        console.log('TrickDisplay: game.trickCards changed:', game.trickCards);
        console.log('TrickDisplay: game.trickComplete:', game.trickComplete);
        
        if (!game.trickCards) {
            console.log('TrickDisplay: No trick cards, setting empty state');
            setPhase({ state: 'empty' });
            return;
        }

        // If we're showing a completed trick, don't interrupt it
        if (phase.state === 'showing_completed_trick') {
            console.log('TrickDisplay: Already showing completed trick, not interrupting');
            return;
        }

        // Check if trick is complete
        if (game.trickComplete && game.trickWinner) {
            console.log('TrickDisplay: Trick completed, winner:', game.trickWinner);
            
            // Cast is safe because we verified all cards are non-null
            const cards = game.trickCards as Record<Seat, CardType>;
            const winner = game.trickWinner as Seat; // Safe because we checked it exists

            // Show completed trick
            setPhase({ 
                state: 'showing_completed_trick',
                cards,
                winner
            });

            // Schedule clearing after delay
            if (clearTimeoutRef.current) {
                clearTimeout(clearTimeoutRef.current);
            }
            
            clearTimeoutRef.current = setTimeout(() => {
                console.log('TrickDisplay: Clearing timeout triggered');
                if (onTrickComplete) {
                    console.log('TrickDisplay: Calling onTrickComplete with winner:', winner);
                    onTrickComplete(cards, winner);
                }
                setPhase({ state: 'clearing' });
            }, 3000);
        } else {
            // Still collecting cards
            console.log('TrickDisplay: Still collecting cards');
            setPhase({
                state: 'collecting_cards',
                cards: game.trickCards
            });
        }
    }, [game.trickCards, game.trickComplete, game.trickWinner]);

    const renderPlayedCard = (seat: Seat, card: CardType, isWinner: boolean = false) => {
        // Simple positioning - each card closest to its player
        const positions = {
            'A1': 'absolute top-16 left-1/2 -translate-x-1/2',     // Top (near A1 player)
            'B1': 'absolute right-16 top-1/2 -translate-y-1/2',    // Right (near B1 player)
            'A2': 'absolute bottom-16 left-1/2 -translate-x-1/2',  // Bottom (near A2 player)
            'B2': 'absolute left-16 top-1/2 -translate-y-1/2'      // Left (near B2 player)
        };

        return (
            <div
                key={`${seat}-${card.suit}-${card.number}`}
                className={`
                    ${positions[seat]}
                    ${seat === 'B1' ? '-rotate-90' :
                      seat === 'A2' ? 'rotate-180' :
                      seat === 'B2' ? 'rotate-90' : ''}
                    transition-all duration-300
                    ${isWinner ? 'z-10' : 'z-0'}
                    ${isWinner ? 'drop-shadow-[0_0_8px_rgba(250,204,21,0.5)]' : ''}
                `}
            >
                <Card card={card} highlight={isWinner} />
            </div>
        );
    };

    // Render based on current phase
    const renderTrickContent = () => {
        switch (phase.state) {
            case 'empty':
                return null;

            case 'collecting_cards':
                return Object.entries(phase.cards).map(([seat, card]) => 
                    card && renderPlayedCard(seat as Seat, card)
                );

            case 'showing_completed_trick':
                return (
                    <>
                        {/* Cards with winner highlighted */}
                        {Object.entries(phase.cards).map(([seat, card]) => 
                            renderPlayedCard(
                                seat as Seat,
                                card,
                                seat === phase.winner
                            )
                        )}
                    </>
                );

            case 'clearing':
                return null;
        }
    };

    return (
        <div className="w-1/3 aspect-square bg-green-900 rounded-full relative">
            {renderTrickContent()}
        </div>
    );
} 