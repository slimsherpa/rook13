'use client';

// The legendary redeal. A hand of nothing but 6s, 7s, 8s and 9s is so rare
// (~1 in 45,000 deals) that the family celebrates it. Full-screen moment.
// (Yes, "redeal" is the family name for it — never "misdeal".)

import { GameDoc, Seat } from '@/lib/game/types';
import { sortHand } from '@/lib/game/deck';
import { createShuffledDeck } from '@/lib/game/deck';
import { GameAction } from '@/lib/game/types';
import PlayingCard from '@/components/ui/PlayingCard';

interface RedealOverlayProps {
    game: GameDoc;
    mySeat: Seat | null;
    onAct: (action: GameAction) => void;
}

export default function RedealOverlay({ game, mySeat, onAct }: RedealOverlayProps) {
    if (game.phase !== 'redeal' || !game.redealSeat) return null;
    const offender = game.seats[game.redealSeat];
    const hand = sortHand(game.hands[game.redealSeat]);
    const iAmDealer = mySeat !== null && game.turn === mySeat;

    return (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur flex flex-col items-center justify-center p-6 text-center">
            <div className="animate-bounce">
                <span className="material-symbols-outlined text-yellow-400 text-6xl">celebration</span>
            </div>
            <h1 className="font-orbitron text-4xl sm:text-5xl font-black text-yellow-400 mt-2 drop-shadow-[0_0_25px_rgba(234,179,8,0.8)]">
                REDEAL!
            </h1>
            <p className="text-white font-orbitron mt-3 text-sm sm:text-base max-w-sm">
                <span className="font-bold">{offender.name.split(' ')[0]}</span> was dealt nothing but
                6s, 7s, 8s and 9s — a once-in-a-lifetime hand!
            </p>
            <div className="flex flex-wrap justify-center gap-1 mt-5 max-w-md">
                {hand.map((c) => (
                    <div key={`${c.suit}-${c.number}`} className="animate-card-reveal">
                        <PlayingCard card={c} size="sm" />
                    </div>
                ))}
            </div>
            <p className="text-green-100/60 text-xs mt-4 font-orbitron">
                House rule: the whole hand gets thrown in and redealt.
            </p>
            {iAmDealer ? (
                <button
                    onClick={() => onAct({ type: 'ACK_REDEAL', deck: createShuffledDeck() })}
                    className="mt-5 px-8 py-3 bg-yellow-500 hover:bg-yellow-400 text-green-950 rounded-xl font-orbitron font-bold shadow-lg active:scale-95 transition"
                >
                    Redeal ’em!
                </button>
            ) : (
                <p className="mt-5 text-white/70 font-orbitron text-xs">
                    Waiting for {game.turn ? game.seats[game.turn].name.split(' ')[0] : 'the dealer'} to redeal…
                </p>
            )}
        </div>
    );
}
