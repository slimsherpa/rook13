'use client';

// The signed-in player's hand.
//
// Card order is a personal thing in this family, so it's local to the device:
// cards start in dealt (random) order, you can drag them around to arrange
// them however you like, or tap the sort button to group by suit (trump
// first). Widow cards simply append to the right, ready to be organized.
// During go-down selection the hand wraps to two rows so all 13 cards are
// visible on a phone.

import { useEffect, useRef, useState } from 'react';
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

const DRAG_THRESHOLD_PX = 8;

export default function MyHand({ game, seat, selecting, selected, onToggleSelect, onPlay }: MyHandProps) {
    const hand = game.hands[seat];

    // ---- local arrangement ----
    const [order, setOrder] = useState<string[]>([]);
    useEffect(() => {
        setOrder((prev) => {
            const keys = hand.map(cardKey);
            const kept = prev.filter((k) => keys.includes(k));
            const added = keys.filter((k) => !kept.includes(k));
            if (added.length === 0 && kept.length === prev.length) return prev;
            return [...kept, ...added];
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [game.hands[seat].length, game.handNumber, seat]);

    // ---- drag to reorder (pointer events cover touch + mouse) ----
    const containerRef = useRef<HTMLDivElement>(null);
    const dragInfo = useRef<{ key: string; startX: number; index: number; slot: number; moved: boolean } | null>(null);
    const suppressTap = useRef(false);
    const [drag, setDrag] = useState<{ key: string; dx: number } | null>(null);

    const slotWidth = (): number => {
        const el = containerRef.current;
        if (!el || el.children.length < 2) return 36;
        const a = (el.children[0] as HTMLElement).getBoundingClientRect();
        const b = (el.children[1] as HTMLElement).getBoundingClientRect();
        return Math.max(20, Math.abs(b.left - a.left));
    };

    const handlePointerDown = (e: React.PointerEvent, key: string, index: number) => {
        dragInfo.current = { key, startX: e.clientX, index, slot: slotWidth(), moved: false };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        const info = dragInfo.current;
        if (!info) return;
        const dx = e.clientX - info.startX;
        if (Math.abs(dx) > DRAG_THRESHOLD_PX) info.moved = true;
        if (info.moved) setDrag({ key: info.key, dx });
    };

    const handlePointerUp = () => {
        const info = dragInfo.current;
        dragInfo.current = null;
        setDrag(null);
        if (!info || !info.moved) return;
        suppressTap.current = true;
        setTimeout(() => { suppressTap.current = false; }, 0);
        const shift = Math.round((drag?.dx ?? 0) / info.slot);
        if (shift === 0) return;
        setOrder((prev) => {
            const from = prev.indexOf(info.key);
            if (from === -1) return prev;
            const to = Math.max(0, Math.min(prev.length - 1, from + shift));
            if (to === from) return prev;
            const next = [...prev];
            next.splice(from, 1);
            next.splice(to, 0, info.key);
            return next;
        });
    };

    const handleSort = () => {
        setOrder(sortHand(hand, game.trump).map(cardKey));
    };

    if (hand.length === 0) return <div className="h-20 sm:h-24" />;

    const byKey = new Map(hand.map((c) => [cardKey(c), c]));
    const orderedHand: Card[] = [
        ...order.map((k) => byKey.get(k)).filter((c): c is Card => !!c),
        ...hand.filter((c) => !order.includes(cardKey(c))),
    ];

    const myTurn = game.turn === seat;
    const playable = game.phase === 'playing' && myTurn;
    const legal = playable ? legalCards(game, seat) : [];

    return (
        <div className="relative px-2">
            {/* sort button */}
            <button
                onClick={handleSort}
                title="Sort by suit"
                className="absolute -top-4 right-3 z-30 w-9 h-9 rounded-full bg-green-700 hover:bg-green-600 border border-green-500/50 shadow-lg flex items-center justify-center"
            >
                <span className="material-symbols-outlined text-white text-lg">sort</span>
            </button>

            <div className="flex justify-center">
                <div
                    ref={containerRef}
                    className={`
                        flex -space-x-5 sm:-space-x-4 md:-space-x-2 pt-4 pb-2
                        ${selecting ? 'flex-wrap justify-center gap-y-2 max-w-md' : ''}
                    `}
                >
                    {orderedHand.map((card, i) => {
                        const key = cardKey(card);
                        const isSelected = selected.some((c) => sameCard(c, card));
                        const isLegal = legal.some((c) => sameCard(c, card));
                        const tappable = selecting || (playable && isLegal);
                        const isDragging = drag?.key === key;
                        return (
                            <div
                                key={key}
                                className="touch-none"
                                style={{
                                    zIndex: isDragging ? 60 : i + 1,
                                    transform: isDragging ? `translateX(${drag!.dx}px) translateY(-10px) scale(1.06)` : undefined,
                                    transition: isDragging ? 'none' : 'transform 0.15s ease-out',
                                }}
                                onPointerDown={(e) => handlePointerDown(e, key, i)}
                                onPointerMove={handlePointerMove}
                                onPointerUp={handlePointerUp}
                                onPointerCancel={handlePointerUp}
                            >
                                <PlayingCard
                                    card={card}
                                    trump={game.trump}
                                    size="lg"
                                    selected={isSelected}
                                    disabled={playable && !isLegal}
                                    onClick={() => {
                                        if (suppressTap.current || !tappable) return;
                                        if (selecting) onToggleSelect(card);
                                        else onPlay(card);
                                    }}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
