'use client';

// Center of the table: the cards of the trick in progress. When a trick
// finishes, the engine clears it immediately, so we keep the finished trick
// on screen locally (winner glowing) for a couple of seconds, then the cards
// fly to the winner and shrink away — "captured".
//
// The felt grows a compass pointer that sweeps smoothly around the wheel to
// whoever the game is waiting on — always rotating clockwise, matching the
// direction of play, like the v1 table.

import { useEffect, useRef, useState } from 'react';
import { Card, GameDoc, Seat, Suit, TrickRecord } from '@/lib/game/types';
import { paced } from '@/lib/settings';
import { useTableHold } from '@/lib/tableHold';
import { TablePosition, positionOfSeat } from './layout';
import { themeFor } from './theme';
import PlayingCard from '@/components/ui/PlayingCard';
import RookBird from '@/components/ui/RookBird';

// A played card: mounts back-up (the committed style, so there is no
// first-frame race with CSS animations), holds the blue back for a beat,
// then transition-flips to the face — same mechanism as the hand reveal.
const FLIP_HOLD_MS = 100;
const FLIP_MS = 250;

function TrickCard({ card, trump, highlight }: { card: Card; trump: Suit | null; highlight: boolean }) {
    const [faceUp, setFaceUp] = useState(false);
    useEffect(() => {
        const t = setTimeout(() => setFaceUp(true), paced(FLIP_HOLD_MS));
        return () => clearTimeout(t);
    }, []);
    return (
        <div
            className="relative [transform-style:preserve-3d]"
            style={{
                transform: faceUp ? 'rotateY(0deg)' : 'rotateY(180deg)',
                transition: `transform ${paced(FLIP_MS)}ms ease-out`,
            }}
        >
            <PlayingCard
                card={card}
                trump={trump}
                size="md"
                highlight={highlight}
                className="[backface-visibility:hidden]"
            />
            <div className="absolute inset-0 [transform:rotateY(180deg)] [backface-visibility:hidden]">
                <PlayingCard faceDown size="md" />
            </div>
        </div>
    );
}

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

/** rough slot centers relative to the middle of the felt, for the capture sweep */
const SLOT_VECTORS: Record<TablePosition, { x: number; y: number }> = {
    bottom: { x: 0, y: 88 },
    top: { x: 0, y: -88 },
    left: { x: -88, y: 0 },
    right: { x: 88, y: 0 },
};

const LINGER_MS = 2000;         // let everyone see who took the trick
const SWEEP_MS = 500;           // then the winner scoops the cards
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
    const [sweeping, setSweeping] = useState(false);
    const seenTricks = useRef(game.completedTricks.length);
    // manual table pace: while held, the finished trick just sits there
    const held = useTableHold();
    const wasHeld = useRef(false);

    useEffect(() => {
        const count = game.completedTricks.length;
        if (count > seenTricks.current) {
            seenTricks.current = count;
            setLingering(game.completedTricks[count - 1]);
            setSweeping(false);
            wasHeld.current = false;
        } else if (count < seenTricks.current) {
            // new hand started
            seenTricks.current = count;
            setLingering(null);
            setSweeping(false);
        }
    }, [game.completedTricks.length, game.completedTricks]);

    // the linger→sweep timers run only once nothing is holding the table
    useEffect(() => {
        if (!lingering) return;
        if (held) {
            wasHeld.current = true;
            return;
        }
        // after a manual hold the player has already had their look — short beat
        const linger = wasHeld.current
            ? 350
            : paced(game.phase === 'playing' ? LINGER_MS : LAST_TRICK_LINGER_MS);
        const t1 = setTimeout(() => setSweeping(true), linger);
        const t2 = setTimeout(() => { setLingering(null); setSweeping(false); }, linger + paced(SWEEP_MS));
        return () => { clearTimeout(t1); clearTimeout(t2); };
    }, [lingering, held, game.phase]);

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
    //
    // Bridge the one render between "engine cleared the trick" and "the linger
    // effect committed": without it the four cards unmount for a frame and
    // remount, replaying every flip animation at once.
    const count = game.completedTricks.length;
    const lastTrick = count > 0 ? game.completedTricks[count - 1] : null;
    const bridging = count > seenTricks.current && game.trickPlays.length === 0;
    const activeTrick = bridging ? lastTrick : lingering;
    const showLingering = activeTrick !== null && game.trickPlays.length === 0;
    const plays: { seat: Seat; card: Card }[] = showLingering ? activeTrick!.plays : game.trickPlays;
    const winner: Seat | null = showLingering ? activeTrick!.winner : null;
    const winnerPosition = winner ? positionOfSeat(winner, bottomSeat) : null;

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
                    {/* an SVG polygon, not a CSS border-triangle: border
                        diagonals anti-alias fuzzy, SVG edges render crisp
                        like the felt circle they extend */}
                    <svg
                        className="absolute left-1/2 -translate-x-1/2 -bottom-8"
                        width="76" height="52" viewBox="0 0 76 52" aria-hidden="true"
                        style={{ filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.35))' }}
                    >
                        <path d="M0 0 H76 L38 52 Z" fill={theme.felt} style={{ transition: 'fill 0.7s' }} />
                    </svg>
                </div>
            )}
            {/* felt circle, dyed to match the table — no outline, so the
                pointer reads as part of the same shape */}
            <div
                className="absolute inset-0 rounded-full shadow-inner transition-colors duration-700"
                style={{ backgroundColor: theme.felt }}
            />
            {/* the rook, embossed into the felt. translateZ pins it to its own
                compositor layer: the drop-shadow filter on this very detailed
                path otherwise re-rasterizes (and visibly jitters) whenever the
                animating siblings — pointer sweep, card flips — repaint. */}
            <div
                className="absolute inset-0 rounded-full overflow-hidden flex items-center justify-center pointer-events-none"
                style={{ transform: 'translateZ(0)' }}
            >
                <RookBird
                    className={`w-48 h-48 sm:w-60 sm:h-60 ${theme.emboss}`}
                    // a hairline of light below the dark shape sells the emboss
                    style={{ filter: 'drop-shadow(0 1px 0 rgba(255,255,255,0.07))' }}
                />
            </div>
            {plays.length === 0 && message && (
                <div className="absolute inset-0 flex items-center justify-center px-8 text-center">
                    <span className="text-white/85 text-sm sm:text-base font-orbitron leading-snug">{message}</span>
                </div>
            )}
            {/* the gap between the swept trick and the next lead used to be a
                blank felt — hold a dimmed "last trick" ghost there so you can
                still see what just happened while deciding your next card */}
            {plays.length === 0 && !message && game.phase === 'playing' && lastTrick && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 pointer-events-none opacity-70">
                    <span className="text-white/45 text-[9px] font-orbitron uppercase tracking-widest">Last trick</span>
                    <div className="flex gap-1">
                        {lastTrick.plays.map(({ seat, card }) => (
                            <PlayingCard
                                key={`${seat}-${card.suit}-${card.number}`}
                                card={card}
                                trump={trump}
                                size="xs"
                                highlight={seat === lastTrick.winner}
                            />
                        ))}
                    </div>
                    <span className="text-yellow-300/80 text-[9px] font-orbitron">
                        {game.seats[lastTrick.winner].name.split(' ')[0]} took it
                    </span>
                </div>
            )}
            {plays.map(({ seat, card }) => {
                const slotPosition = positionOfSeat(seat, bottomSeat);
                // capture sweep: every card slides to the winner's slot and shrinks
                const sweepStyle = sweeping && showLingering && winnerPosition
                    ? {
                        transform: `translate(${SLOT_VECTORS[winnerPosition].x - SLOT_VECTORS[slotPosition].x}px, ${SLOT_VECTORS[winnerPosition].y - SLOT_VECTORS[slotPosition].y}px) scale(0.3)`,
                        opacity: 0,
                    }
                    : undefined;
                return (
                    // keyed by card too: a fresh play remounts and runs its flip,
                    // while the settled trick keeps its cards mounted
                    <div
                        key={`${seat}-${card.suit}-${card.number}`}
                        className={SLOT_CLASSES[slotPosition]}
                        style={{ perspective: '700px' }}
                    >
                        <div
                            style={{ transition: `transform ${paced(SWEEP_MS)}ms ease-in, opacity ${paced(SWEEP_MS)}ms ease-in`, ...sweepStyle }}
                        >
                            <TrickCard card={card} trump={trump} highlight={winner === seat} />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
