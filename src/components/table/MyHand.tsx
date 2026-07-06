'use client';

// The signed-in player's hand.
//
// Card order is a personal thing in this family, so it's local to the device:
// cards start in dealt (random) order, you can drag them around to arrange
// them however you like, or tap the sort button to group by suit (trump
// first). Widow cards simply append to the right, ready to be organized.
// During go-down selection the hand wraps to two rows so all 13 cards are
// visible on a phone.
//
// Christmas morning: freshly dealt cards arrive face-down. Tap one (or slide
// a finger across the row) to flip it over. The widow cards the bid winner
// picks up arrive face-down too. Everything auto-reveals when trick play
// starts so an unflipped card can never block the game.
//
// Both tap-to-play and drag-to-reorder are handled through pointer events on
// the wrapper (the card itself is pointer-inert). We deliberately do NOT rely
// on the card button's click: capturing the pointer for dragging retargets
// native click events, which would otherwise swallow taps.

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

    // ---- face-down reveal (the "Christmas morning" flip) ----
    const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
    useEffect(() => {
        // fresh hand: everything starts face-down again
        setRevealedKeys(new Set());
    }, [game.handNumber, seat]);
    useEffect(() => {
        // trick play started — any card still face-down flips itself
        if (game.phase === 'playing' || game.phase === 'hand_done' || game.phase === 'game_over') {
            setRevealedKeys((prev) => {
                const keys = hand.map(cardKey);
                if (keys.every((k) => prev.has(k))) return prev;
                return new Set([...Array.from(prev), ...keys]);
            });
        }
    }, [game.phase, hand]);

    const reveal = (key: string) => {
        setRevealedKeys((prev) => {
            if (prev.has(key)) return prev;
            const next = new Set(prev);
            next.add(key);
            return next;
        });
    };

    // ---- drag / tap (pointer events cover touch + mouse) ----
    const containerRef = useRef<HTMLDivElement>(null);
    const dragInfo = useRef<{ card: Card; key: string; startX: number; slot: number; moved: boolean; dx: number } | null>(null);
    const [dragKey, setDragKey] = useState<string | null>(null);
    const [dragDx, setDragDx] = useState(0);
    // the lift only kicks in once the pointer actually travels — a plain tap
    // must not make the card twitch
    const [dragActive, setDragActive] = useState(false);
    // while true, the pointer is sweeping across face-down cards flipping them
    const revealSweep = useRef(false);

    const slotWidth = (): number => {
        const el = containerRef.current;
        if (!el || el.children.length < 2) return 40;
        const a = (el.children[0] as HTMLElement).getBoundingClientRect();
        const b = (el.children[1] as HTMLElement).getBoundingClientRect();
        return Math.max(20, Math.abs(b.left - a.left));
    };

    const handleTap = (card: Card) => {
        if (selecting) { onToggleSelect(card); return; }
        if (game.phase === 'playing' && game.turn === seat) {
            if (legalCards(game, seat).some((c) => sameCard(c, card))) onPlay(card);
        }
    };

    const onPointerDown = (e: React.PointerEvent, card: Card, key: string) => {
        if (e.button !== undefined && e.button !== 0) return; // left button / touch only
        if (!revealedKeys.has(key)) {
            // face-down card: this press flips cards instead of dragging them
            revealSweep.current = true;
            reveal(key);
            try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
            return;
        }
        dragInfo.current = { card, key, startX: e.clientX, slot: slotWidth(), moved: false, dx: 0 };
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
        setDragKey(key);
        setDragDx(0);
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (revealSweep.current) {
            // flip every face-down card the finger passes over (pointer capture
            // retargets events, so hit-test the document instead)
            const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-cardkey]');
            const key = el instanceof HTMLElement ? el.dataset.cardkey : undefined;
            if (key) reveal(key);
            return;
        }
        const info = dragInfo.current;
        if (!info) return;
        const dx = e.clientX - info.startX;
        info.dx = dx;
        if (Math.abs(dx) > DRAG_THRESHOLD_PX && !info.moved) {
            info.moved = true;
            setDragActive(true);
        }
        setDragDx(dx);
    };

    const onPointerUp = () => {
        if (revealSweep.current) {
            revealSweep.current = false;
            return;
        }
        const info = dragInfo.current;
        dragInfo.current = null;
        setDragKey(null);
        setDragDx(0);
        setDragActive(false);
        if (!info) return;

        if (!info.moved) {
            handleTap(info.card);
            return;
        }
        const shift = Math.round(info.dx / info.slot);
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
        // sorting is the lazy person's reveal: flip whatever's still face-down
        setRevealedKeys(new Set(hand.map(cardKey)));
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
                className="absolute -top-4 right-3 z-30 w-9 h-9 rounded-full bg-black/40 hover:bg-black/55 border border-white/25 shadow-lg flex items-center justify-center"
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
                        const faceUp = revealedKeys.has(key);
                        const isSelected = selected.some((c) => sameCard(c, card));
                        const isLegal = legal.some((c) => sameCard(c, card));
                        const interactive = !faceUp || selecting || (playable && isLegal);
                        const isDragging = dragKey === key && dragActive;
                        return (
                            <div
                                key={key}
                                data-cardkey={key}
                                className={`touch-none ${interactive ? 'cursor-pointer' : 'cursor-default'}`}
                                style={{
                                    zIndex: isDragging ? 60 : i + 1,
                                    transform: isDragging ? `translateX(${dragDx}px) translateY(-10px) scale(1.06)` : undefined,
                                    transition: isDragging ? 'none' : 'transform 0.15s ease-out',
                                    perspective: '700px',
                                }}
                                onPointerDown={(e) => onPointerDown(e, card, key)}
                                onPointerMove={onPointerMove}
                                onPointerUp={onPointerUp}
                                onPointerCancel={onPointerUp}
                            >
                                {/* two faces on a card that rotates in 3D */}
                                <div
                                    className="relative transition-transform duration-300 [transform-style:preserve-3d]"
                                    style={{ transform: faceUp ? 'rotateY(0deg)' : 'rotateY(180deg)' }}
                                >
                                    <PlayingCard
                                        card={card}
                                        trump={game.trump}
                                        size="lg"
                                        selected={isSelected}
                                        disabled={playable && !isLegal}
                                        className="pointer-events-none [backface-visibility:hidden]"
                                    />
                                    <div className="absolute inset-0 [transform:rotateY(180deg)] [backface-visibility:hidden]">
                                        <PlayingCard faceDown size="lg" className="pointer-events-none" />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
