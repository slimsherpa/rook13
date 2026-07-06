'use client';

// Center of the table: the cards of the trick in progress. When a trick
// finishes, the engine clears it immediately, so we keep the finished trick
// on screen locally for a beat (winner glowing) before it sweeps away.
//
// The felt grows a compass pointer that sweeps smoothly around the wheel to
// whoever the game is waiting on — always rotating clockwise, matching the
// direction of play, like the v1 table.

import { useEffect, useRef, useState } from 'react';
import { Card, GameDoc, Seat, Suit, TrickRecord } from '@/lib/game/types';
import { TablePosition, positionOfSeat } from './layout';
import { themeFor } from './theme';
import PlayingCard from '@/components/ui/PlayingCard';
import RookBird from '@/components/ui/RookBird';

const SLOT_CLASSES: Record<TablePosition, string> = {
    bottom: 'absolute left-1/2 -translate-x-1/2 bottom-1',
    top: 'absolute left-1/2 -translate-x-1/2 top-1',
    left: 'absolute top-1/2 -translate-y-1/2 left-2',
    right: 'absolute top-1/2 -translate-y-1/2 right-2',
};

/** pointer angle for each position; play order runs clockwise so angles only grow */
const POSITION_ANGLE: Record<TablePosition, number> = {
    bottom: 0,
    left: 90,
    top: 180,
    right: 270,
};

const LINGER_MS = 1700;
// the final trick of a hand hangs around longer — the recap is coming and
// people want to see how it ended
const LAST_TRICK_LINGER_MS = 3200;

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
            const linger = game.phase === 'playing' ? LINGER_MS : LAST_TRICK_LINGER_MS;
            const t = setTimeout(() => setLingering(null), linger);
            return () => clearTimeout(t);
        }
        if (count < seenTricks.current) {
            // new hand started
            seenTricks.current = count;
            setLingering(null);
        }
    }, [game.completedTricks.length, game.completedTricks, game.phase]);

    // ---- compass pointer: accumulate rotation so it always sweeps clockwise ----
    const turnPosition = game.status === 'active' && game.turn
        ? positionOfSeat(game.turn, bottomSeat)
        : null;
    const [angle, setAngle] = useState<number | null>(null);

    useEffect(() => {
        if (!turnPosition) return;
        const target = POSITION_ANGLE[turnPosition];
        setAngle((prev) => {
            if (prev === null) return target;
            const current = ((prev % 360) + 360) % 360;
            const delta = (target - current + 360) % 360; // clockwise distance
            return prev + delta;
        });
    }, [turnPosition]);

    // A fresh play always takes priority over the lingering old trick.
    const showLingering = lingering !== null && game.trickPlays.length === 0;
    const plays: { seat: Seat; card: Card }[] = showLingering ? lingering!.plays : game.trickPlays;
    const winner: Seat | null = showLingering ? lingering!.winner : null;

    const theme = themeFor(trump);

    return (
        // a true circle (square box) so the compass pointer sweeps cleanly
        <div className="relative w-60 h-60 sm:w-72 sm:h-72">
            {/* compass pointer sweeps behind the felt; same solid color so it
                reads as the circle growing a point, v1-style */}
            {angle !== null && (
                <div
                    className={`absolute inset-0 transition-all duration-700 ease-in-out ${turnPosition ? 'opacity-100' : 'opacity-0'}`}
                    style={{ transform: `rotate(${angle}deg)` }}
                >
                    <div className="absolute left-1/2 -translate-x-1/2 -bottom-8 w-0 h-0
                        border-l-[38px] border-l-transparent
                        border-r-[38px] border-r-transparent
                        border-t-[52px]
                        drop-shadow-[0_3px_4px_rgba(0,0,0,0.35)]"
                        style={{ borderTopColor: theme.felt, transition: 'border-top-color 0.7s' }} />
                </div>
            )}
            {/* felt circle, dyed to match the table */}
            <div
                className="absolute inset-0 rounded-full border border-white/10 shadow-inner transition-colors duration-700"
                style={{ backgroundColor: theme.felt }}
            />
            {/* the rook, embossed into the felt */}
            <div className="absolute inset-0 rounded-full overflow-hidden flex items-center justify-center pointer-events-none">
                <RookBird
                    className="w-48 h-48 sm:w-60 sm:h-60 text-black/30"
                    // a hairline of light below the dark shape sells the emboss
                    style={{ filter: 'drop-shadow(0 1px 0 rgba(255,255,255,0.07))' }}
                />
            </div>
            {plays.length === 0 && message && (
                <div className="absolute inset-0 flex items-center justify-center px-8 text-center">
                    <span className="text-white/85 text-sm sm:text-base font-orbitron leading-snug">{message}</span>
                </div>
            )}
            {plays.map(({ seat, card }) => (
                <div key={seat} className={`${SLOT_CLASSES[positionOfSeat(seat, bottomSeat)]} animate-card-reveal`}>
                    <PlayingCard
                        card={card}
                        trump={trump}
                        size="md"
                        highlight={winner === seat}
                    />
                </div>
            ))}
        </div>
    );
}
