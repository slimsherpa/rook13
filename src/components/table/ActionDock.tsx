'use client';

// The contextual control strip above the player's hand: deal button, bid
// panel, go-down confirm, trump picker — whatever the current phase needs
// from *this* player. Renders a status line when it's someone else's move.

import { useEffect, useState } from 'react';
import { Card, GameDoc, Seat, Suit, SUITS, VALID_BIDS } from '@/lib/game/types';
import { minNextBid, mustBid, isLaydown } from '@/lib/game/engine';
import { createShuffledDeck } from '@/lib/game/deck';
import { GameAction } from '@/lib/game/types';
import { AdviceMap, optionKey } from '@/lib/alpharook/advice';
import AssistDial from './AssistDial';

interface ActionDockProps {
    game: GameDoc;
    mySeat: Seat | null;
    selectedGoDown: Card[];
    onAct: (action: GameAction) => void;
    onConfirmGoDown: () => void;
    advice?: AdviceMap; // AI trainer: pick-likelihood per option (undefined = off)
}

const suitButtonColors: Record<Suit, string> = {
    Red: 'bg-red-600 hover:bg-red-500',
    Yellow: 'bg-yellow-500 hover:bg-yellow-400 text-navy-950',
    Black: 'bg-gray-900 hover:bg-gray-800',
    Green: 'bg-green-600 hover:bg-green-500',
};

export default function ActionDock({ game, mySeat, selectedGoDown, onAct, onConfirmGoDown, advice }: ActionDockProps) {
    // Tap-through guard (prod incident, game 8563im…, 2026-07-14): the dock
    // swaps contents the instant a phase changes, so the follow-through of
    // a tap on "Put Down" landed on the trump button that appeared at the
    // same spot — committing Yellow trump the player never chose (log
    // indices 94→95, 1.5s apart, a Red-planned go-down). New controls stay
    // inert for a beat after every phase change.
    const [settled, setSettled] = useState(false);
    // trump is the most irreversible tap in the game: two-step confirm
    const [trumpPick, setTrumpPick] = useState<Suit | null>(null);
    useEffect(() => {
        setSettled(false);
        setTrumpPick(null);
        const t = setTimeout(() => setSettled(true), 600);
        return () => clearTimeout(t);
    }, [game.phase, game.handNumber]);

    if (!mySeat) return null;
    const myTurn = game.turn === mySeat;
    const turnName = game.turn ? game.seats[game.turn].name.split(' ')[0] : '';

    const Status = ({ text }: { text: string }) => (
        <div className="text-center text-white/85 font-orbitron text-xs sm:text-sm py-2">{text}</div>
    );

    switch (game.phase) {
        case 'dealing': {
            if (!myTurn) return <Status text={`Waiting for ${turnName} to deal…`} />;
            return (
                <div className="flex justify-center py-1.5">
                    <button
                        onClick={() => onAct({ type: 'DEAL', deck: createShuffledDeck() })}
                        className="px-8 py-3 bg-sky-600 hover:bg-sky-500 text-white rounded-xl font-orbitron text-lg shadow-lg flex items-center gap-2 active:scale-95 transition"
                    >
                        <span className="material-symbols-outlined">style</span>
                        Deal Cards
                    </button>
                </div>
            );
        }

        case 'bidding': {
            if (!myTurn) return <Status text={`${turnName} is bidding…`} />;
            const floor = minNextBid(game);
            const forced = mustBid(game);
            const options = floor === null ? [] : VALID_BIDS.filter((b) => b >= floor);
            return (
                <div className="px-2 py-1.5">
                    {forced && (
                        <div className="text-center text-yellow-300 font-orbitron text-xs mb-1">
                            Everyone passed — you must bid!
                        </div>
                    )}
                    <div className="overflow-x-auto pb-1 custom-scrollbar">
                        {/* w-max + mx-auto: centered when the options fit
                            (desktop), scrollable when they don't (phones) */}
                        <div className="flex gap-1.5 items-center w-max mx-auto">
                            <button
                                onClick={() => onAct({ type: 'BID', seat: mySeat, bid: 'pass' })}
                                disabled={forced}
                                className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-white font-orbitron text-sm"
                            >
                                Pass
                                {advice && <AssistDial p={advice.get(optionKey.bid('pass'))} />}
                            </button>
                            {options.map((bid) => (
                                <button
                                    key={bid}
                                    onClick={() => onAct({ type: 'BID', seat: mySeat, bid })}
                                    className="flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-orbitron font-bold text-sm active:scale-95 transition"
                                >
                                    {bid}
                                    {advice && <AssistDial p={advice.get(optionKey.bid(bid))} />}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            );
        }

        case 'widow': {
            if (game.bidWinner !== mySeat) return <Status text={`${turnName} won the bid and is choosing the go-down…`} />;
            const n = selectedGoDown.length;
            return (
                <div className="flex items-center justify-center gap-3 py-1.5">
                    <span className="text-white/90 font-orbitron text-xs sm:text-sm">
                        Go-down: pick 4 cards ({n}/4)
                    </span>
                    <button
                        onClick={onConfirmGoDown}
                        disabled={n !== 4}
                        className="px-5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white font-orbitron text-sm font-bold active:scale-95 transition"
                    >
                        Put Down
                    </button>
                </div>
            );
        }

        case 'trump': {
            if (game.bidWinner !== mySeat) return <Status text={`${turnName} is calling trump…`} />;
            // Pick a color in the dock, then confirm with the big button that
            // appears in the CENTER of the table — no more sliding a thumb
            // across a crowded row to reach a tiny "Confirm" on a phone.
            return (
                <>
                    <div className="flex items-center justify-center gap-2 py-1.5 flex-wrap">
                        <span className="text-white/90 font-orbitron text-xs sm:text-sm mr-1">Trump:</span>
                        {SUITS.map((suit) => (
                            <button
                                key={suit}
                                disabled={!settled}
                                onClick={() => setTrumpPick(suit)}
                                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-white font-orbitron text-sm font-bold active:scale-95 transition disabled:opacity-40 ${suitButtonColors[suit]} ${trumpPick === suit ? 'ring-4 ring-white' : trumpPick ? 'opacity-50' : ''}`}
                            >
                                {suit}
                                {advice && <AssistDial p={advice.get(optionKey.trump(suit))} />}
                            </button>
                        ))}
                    </div>
                    {trumpPick && settled && (
                        // centered by a flex wrapper, NOT translate classes: the
                        // pop animation drives `transform`, which would override
                        // -translate-x/y mid-animation and make the button mount
                        // off-center then jump into place when the pop ends
                        <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
                        <button
                            onClick={() => onAct({ type: 'SELECT_TRUMP', seat: mySeat, suit: trumpPick })}
                            className={`pointer-events-auto px-8 py-5 rounded-3xl text-white font-orbitron shadow-2xl ring-4 ring-white/70 active:scale-95 transition animate-announce-pop ${suitButtonColors[trumpPick]}`}
                        >
                            <span className="block text-2xl font-black leading-tight">{trumpPick} Trump</span>
                            <span className="block text-sm font-bold mt-1 flex items-center justify-center gap-1">
                                Start the hand
                                <span className="material-symbols-outlined text-lg">arrow_forward</span>
                            </span>
                        </button>
                        </div>
                    )}
                </>
            );
        }

        case 'playing': {
            if (!myTurn) return <Status text={`${turnName}'s turn…`} />;
            // every card left is a lock — offer to claim the rest of the hand
            if (isLaydown(game, mySeat)) {
                return (
                    <div className="flex items-center justify-center gap-3 py-1.5">
                        <span className="text-white/90 font-orbitron text-xs sm:text-sm">All winners!</span>
                        <button
                            onClick={() => onAct({ type: 'LAYDOWN', seat: mySeat })}
                            className="px-5 py-2.5 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-navy-950 font-orbitron text-sm font-bold shadow-[0_0_14px_rgba(234,179,8,0.45)] active:scale-95 transition flex items-center gap-1.5"
                        >
                            <span className="material-symbols-outlined text-lg">celebration</span>
                            Lay Them Down
                        </button>
                    </div>
                );
            }
            return <Status text="Your turn — tap a card" />;
        }

        default:
            return null;
    }
}
