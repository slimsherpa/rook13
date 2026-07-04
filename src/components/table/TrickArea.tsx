'use client';

// Center of the table: the cards of the trick in progress. When a trick
// finishes, the engine clears it immediately, so we keep the finished trick
// on screen locally for a beat (winner glowing) before it sweeps away.

import { useEffect, useRef, useState } from 'react';
import { Card, GameDoc, Seat, Suit, TrickRecord } from '@/lib/game/types';
import { TablePosition, positionOfSeat } from './layout';
import PlayingCard from '@/components/ui/PlayingCard';

const SLOT_CLASSES: Record<TablePosition, string> = {
    bottom: 'absolute left-1/2 -translate-x-1/2 bottom-0',
    top: 'absolute left-1/2 -translate-x-1/2 top-0',
    left: 'absolute top-1/2 -translate-y-1/2 left-0',
    right: 'absolute top-1/2 -translate-y-1/2 right-0',
};

const LINGER_MS = 1700;

interface TrickAreaProps {
    game: GameDoc;
    bottomSeat: Seat;
    trump: Suit | null;
    /** center message when no cards are on the table (e.g. waiting text) */
    message?: string | null;
}

export default function TrickArea({ game, bottomSeat, trump, message }: TrickAreaProps) {
    const [lingering, setLingering] = useState<TrickRecord | null>(null);
    const seenTricks = useRef(game.completedTricks.length);

    useEffect(() => {
        const count = game.completedTricks.length;
        if (count > seenTricks.current) {
            seenTricks.current = count;
            const last = game.completedTricks[count - 1];
            setLingering(last);
            const t = setTimeout(() => setLingering(null), LINGER_MS);
            return () => clearTimeout(t);
        }
        if (count < seenTricks.current) {
            // new hand started
            seenTricks.current = count;
            setLingering(null);
        }
    }, [game.completedTricks.length, game.completedTricks]);

    // A fresh play always takes priority over the lingering old trick.
    const showLingering = lingering !== null && game.trickPlays.length === 0;
    const plays: { seat: Seat; card: Card }[] = showLingering ? lingering!.plays : game.trickPlays;
    const winner: Seat | null = showLingering ? lingering!.winner : null;

    return (
        <div className="relative w-52 h-44 sm:w-72 sm:h-60">
            {/* felt circle */}
            <div className="absolute inset-0 rounded-full bg-green-950/60 border border-green-700/40 shadow-inner" />
            {plays.length === 0 && message && (
                <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
                    <span className="text-green-100/70 text-xs sm:text-sm font-orbitron leading-snug">{message}</span>
                </div>
            )}
            {plays.map(({ seat, card }) => (
                <div key={seat} className={`${SLOT_CLASSES[positionOfSeat(seat, bottomSeat)]} animate-card-in`}>
                    <PlayingCard
                        card={card}
                        trump={trump}
                        size="sm"
                        highlight={winner === seat}
                    />
                </div>
            ))}
        </div>
    );
}
