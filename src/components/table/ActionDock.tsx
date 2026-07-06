'use client';

// The contextual control strip above the player's hand: deal button, bid
// panel, go-down confirm, trump picker — whatever the current phase needs
// from *this* player. Renders a status line when it's someone else's move.

import { Card, GameDoc, Seat, Suit, SUITS, VALID_BIDS } from '@/lib/game/types';
import { minNextBid, mustBid } from '@/lib/game/engine';
import { createShuffledDeck } from '@/lib/game/deck';
import { GameAction } from '@/lib/game/types';

interface ActionDockProps {
    game: GameDoc;
    mySeat: Seat | null;
    selectedGoDown: Card[];
    onAct: (action: GameAction) => void;
    onConfirmGoDown: () => void;
}

const suitButtonColors: Record<Suit, string> = {
    Red: 'bg-red-600 hover:bg-red-500',
    Yellow: 'bg-yellow-500 hover:bg-yellow-400 text-navy-950',
    Black: 'bg-gray-900 hover:bg-gray-800',
    Green: 'bg-green-600 hover:bg-green-500',
};

export default function ActionDock({ game, mySeat, selectedGoDown, onAct, onConfirmGoDown }: ActionDockProps) {
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
                    <div className="flex gap-1.5 items-center overflow-x-auto pb-1 custom-scrollbar">
                        <button
                            onClick={() => onAct({ type: 'BID', seat: mySeat, bid: 'pass' })}
                            disabled={forced}
                            className="flex-shrink-0 px-4 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-white font-orbitron text-sm"
                        >
                            Pass
                        </button>
                        {options.map((bid) => (
                            <button
                                key={bid}
                                onClick={() => onAct({ type: 'BID', seat: mySeat, bid })}
                                className="flex-shrink-0 px-3.5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-orbitron font-bold text-sm active:scale-95 transition"
                            >
                                {bid}
                            </button>
                        ))}
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
            return (
                <div className="flex items-center justify-center gap-2 py-1.5">
                    <span className="text-white/90 font-orbitron text-xs sm:text-sm mr-1">Trump:</span>
                    {SUITS.map((suit) => (
                        <button
                            key={suit}
                            onClick={() => onAct({ type: 'SELECT_TRUMP', seat: mySeat, suit })}
                            className={`px-4 py-2.5 rounded-lg text-white font-orbitron text-sm font-bold active:scale-95 transition ${suitButtonColors[suit]}`}
                        >
                            {suit}
                        </button>
                    ))}
                </div>
            );
        }

        case 'playing': {
            if (!myTurn) return <Status text={`${turnName}'s turn…`} />;
            return <Status text="Your turn — tap a card" />;
        }

        default:
            return null;
    }
}
