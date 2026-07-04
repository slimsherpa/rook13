'use client';

// The signed-in player's hand: an overlapping fan that stays playable with
// 13 cards on a 375px phone. Handles both trick play and go-down selection.

import { Card, GameDoc, Seat, sameCard, cardKey } from '@/lib/game/types';
import { legalCards } from '@/lib/game/engine';
import { sortHand } from '@/lib/game/deck';
import PlayingCard from '@/components/ui/PlayingCard';

interface MyHandProps {
    game: GameDoc;
    seat: Seat;
    selecting: boolean;           // widow phase: tap to select go-down cards
    selected: Card[];
    onToggleSelect: (card: Card) => void;
    onPlay: (card: Card) => void;
}

export default function MyHand({ game, seat, selecting, selected, onToggleSelect, onPlay }: MyHandProps) {
    const hand = sortHand(game.hands[seat], game.trump);
    if (hand.length === 0) return <div className="h-20 sm:h-24" />;

    const myTurn = game.turn === seat;
    const playable = game.phase === 'playing' && myTurn;
    const legal = playable ? legalCards(game, seat) : [];

    return (
        <div className="flex justify-center px-2">
            <div className="flex -space-x-5 sm:-space-x-4 md:-space-x-2 pt-4 pb-2">
                {hand.map((card, i) => {
                    const isSelected = selected.some((c) => sameCard(c, card));
                    const isLegal = legal.some((c) => sameCard(c, card));
                    const clickable = selecting || (playable && isLegal);
                    return (
                        <div key={cardKey(card)} style={{ zIndex: i + 1 }} className="transition-transform">
                            <PlayingCard
                                card={card}
                                trump={game.trump}
                                size="lg"
                                selected={isSelected}
                                disabled={playable && !isLegal}
                                onClick={clickable
                                    ? () => (selecting ? onToggleSelect(card) : onPlay(card))
                                    : undefined}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
