'use client';

// The card counter: the family scorekeeper's pencil-and-paper grid, digitized.
// Forty tiny card chips ride the top-left of the felt — trump suit on top,
// then the rest — and every card that hits the felt PUNCHES out of the grid
// with a flash, leaving an empty socket behind. No labels: ranks always run
// 14→10 over 9→5, and the family knows the drill. Point cards (5s, 10s, 13s)
// carry a white pip, echoing the point circle on the real card faces.
//
// The grid tracks UNKNOWN cards — where could the outstanding cards be? So
// "seen" is everything this viewer can account for: every card played
// face-up this hand (the current trick + all completed tricks), plus your
// own hand (you know exactly where those are — they start punched), plus,
// on the bid winner's own device only, their go-down: they watched those
// four leave the game, so their grid doesn't wait for cards that can never
// come. What's left standing is other people's hands and the hidden widow.

import { useRef } from 'react';
import { GameDoc, Seat, Suit, SUITS, cardKey, getCardPoints } from '@/lib/game/types';
import { luminance, paletteById, shade, tint } from '@/lib/game/palettes';
import { useCardPaletteId } from '@/lib/settings';

// The card counter's signature color — orange, next to the trainer's pink,
// used nowhere else, so a counting table reads at a glance.
export const COUNTER_ORANGE = '#ff9100';

// chip fills, glossed light-to-dark so they read as tiny cards on every
// trump-colored table; very dark suits get a lifted top + brighter edge
// so they never melt into the dark felt. Follows the device's card
// palette (cosmetic setting) — standard reproduces the original gloss.
const chipFor = (hue: string): { fill: string; edge: string } => {
    const dark = luminance(hue) < 0.12;
    return {
        fill: `linear-gradient(145deg, ${tint(hue, dark ? 0.3 : 0.35)}, ${shade(hue, dark ? 1 : 0.8)})`,
        edge: dark ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.4)',
    };
};

// two rows per suit, high half over low half
const ROWS: number[][] = [[14, 13, 12, 11, 10], [9, 8, 7, 6, 5]];

/** Every card this viewer can account for so far this hand. */
const seenKeys = (game: GameDoc, mySeat: Seat | null): Set<string> => {
    const seen = new Set<string>();
    for (const trick of game.completedTricks) for (const p of trick.plays) seen.add(cardKey(p.card));
    for (const p of game.trickPlays) seen.add(cardKey(p.card));
    if (mySeat !== null) {
        // your own hand is no mystery — those punch out from the start
        for (const c of game.hands[mySeat]) seen.add(cardKey(c));
        // the taker saw the widow — their go-down is dead and they know it
        if (game.bidWinner === mySeat) for (const c of game.goDown) seen.add(cardKey(c));
    }
    return seen;
};

export default function CardCounter({ game, mySeat }: { game: GameDoc; mySeat: Seat | null }) {
    const trump = game.trump;
    const seen = seenKeys(game, mySeat);
    const [paletteId] = useCardPaletteId();
    const palette = paletteById(paletteId);

    // cards already seen when the grid mounted (a mid-hand settings flip)
    // start as bare sockets — only cards seen while we're watching get the
    // punch-out animation
    const mountSeen = useRef<Set<string> | null>(null);
    if (mountSeen.current === null) mountSeen.current = new Set(seen);

    if (!trump) return null;
    const suitOrder: Suit[] = [trump, ...SUITS.filter((s) => s !== trump)];

    const slot = (suit: Suit, n: number) => {
        const key = `${suit}-${n}`;
        const isSeen = seen.has(key);
        const points = getCardPoints({ suit, number: n });
        const label = `${suit} ${n}${points ? ` · ${points} pts` : ''}${isSeen ? ' — played' : ''}`;
        return (
            <div key={key} className="relative w-[11px] h-[14px]" title={label}>
                {/* the punched socket, waiting under every chip */}
                <div className="absolute inset-0 rounded-[3px] bg-black/40 border border-white/10 shadow-[inset_0_1px_2px_rgba(0,0,0,0.7)]" />
                {/* the chip — punches out (and stays gone) once the card is seen */}
                {!(isSeen && mountSeen.current!.has(key)) && (
                    <div
                        className={`absolute inset-0 rounded-[3px] ${isSeen ? 'animate-counter-punch' : ''}`}
                        style={(() => {
                            const chip = chipFor(palette.suits[suit]);
                            return {
                                background: chip.fill,
                                border: `1px solid ${chip.edge}`,
                                boxShadow: '0 1px 2px rgba(0,0,0,0.5)',
                            };
                        })()}
                    >
                        {points > 0 && (
                            <span className="absolute inset-0 flex items-center justify-center">
                                <span className="w-[4px] h-[4px] rounded-full bg-white shadow-[0_0_3px_rgba(255,255,255,0.9)]" />
                            </span>
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="rounded-lg bg-black/35 backdrop-blur-sm border border-white/10 p-1.5 shadow-lg animate-card-reveal flex flex-col gap-[5px]">
            {suitOrder.map((suit) => (
                /* no trump marker on purpose: any accent color reads as a suit
                   color here — the top block simply IS trump, and the family
                   learns that once */
                <div
                    key={suit}
                    className="grid grid-cols-5 gap-[2px]"
                    title={suit === trump ? `${suit} — trump` : suit}
                >
                    {ROWS.flat().map((n) => slot(suit, n))}
                </div>
            ))}
        </div>
    );
}
