'use client';

// The live table. Mobile-first: you always sit at the bottom, partner across
// the top, play runs clockwise bottom -> left -> top -> right.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, GameAction, GameDoc, Seat, sameCard } from '@/lib/game/types';
import { positionsFor } from './layout';
import PlayerBadge from './PlayerBadge';
import TrickArea from './TrickArea';
import MyHand from './MyHand';
import ActionDock from './ActionDock';
import HandRecapModal from './HandRecapModal';
import ScoreSheetModal from './ScoreSheetModal';
import RedealOverlay from './RedealOverlay';
import GameOverOverlay from './GameOverOverlay';
import PlayingCard from '@/components/ui/PlayingCard';

interface TableViewProps {
    game: GameDoc;
    mySeat: Seat | null; // null = spectator
    act: (action: GameAction) => Promise<void>;
    actionError: string | null;
}

const suitChipColors: Record<string, string> = {
    Red: 'bg-red-600',
    Yellow: 'bg-yellow-500 text-green-950',
    Black: 'bg-gray-900',
    Green: 'bg-green-600',
};

export default function TableView({ game, mySeat, act, actionError }: TableViewProps) {
    const router = useRouter();
    const bottomSeat: Seat = mySeat ?? 'A1';
    const pos = positionsFor(bottomSeat);
    const [selectedGoDown, setSelectedGoDown] = useState<Card[]>([]);
    const [showScores, setShowScores] = useState(false);
    const [goDownPeek, setGoDownPeek] = useState(false);

    // reset go-down selection whenever the phase moves on
    useEffect(() => {
        if (game.phase !== 'widow') setSelectedGoDown([]);
    }, [game.phase]);

    const toggleGoDown = (card: Card) => {
        setSelectedGoDown((prev) => {
            if (prev.some((c) => sameCard(c, card))) return prev.filter((c) => !sameCard(c, card));
            if (prev.length >= 4) return prev;
            return [...prev, card];
        });
    };

    const centerMessage = (() => {
        switch (game.phase) {
            case 'bidding':
                return game.highBid
                    ? `Bid ${game.highBid} · ${game.turn ? game.seats[game.turn].name.split(' ')[0] : ''} to act`
                    : 'Bidding opens at 65';
            case 'widow':
                return `${game.seats[game.bidWinner!].name.split(' ')[0]} took it at ${game.highBid}`;
            case 'trump':
                return 'Calling trump…';
            case 'dealing': {
                const dealerName = game.dealer === mySeat ? 'you' : game.seats[game.dealer!].name.split(' ')[0];
                return `Hand ${game.handNumber} · dealer: ${dealerName}`;
            }
            default:
                return null;
        }
    })();

    const showBids = game.phase === 'bidding' || game.phase === 'widow' || game.phase === 'trump';
    const iAmBidWinner = mySeat !== null && game.bidWinner === mySeat;
    const selectingGoDown = game.phase === 'widow' && iAmBidWinner;

    const badge = (seat: Seat, horizontal?: boolean) => (
        <PlayerBadge
            seat={seat}
            info={game.seats[seat]}
            isDealer={game.dealer === seat}
            isTurn={game.turn === seat && game.status === 'active'}
            bid={showBids ? game.bids[seat] : (game.bidWinner === seat && game.highBid ? game.highBid : undefined)}
            cardsLeft={game.phase === 'playing' ? game.hands[seat].length : undefined}
            horizontal={horizontal}
        />
    );

    return (
        <div className="h-dvh w-full flex flex-col bg-green-800 overflow-hidden">
            {/* header */}
            <header className="flex items-center justify-between px-3 py-2 bg-green-950/60 border-b border-green-700/40">
                <div className="flex items-center gap-2">
                    <button onClick={() => router.push('/')} className="text-white/70 hover:text-white flex items-center" title="Lobby">
                        <span className="material-symbols-outlined">arrow_back</span>
                    </button>
                    <span className="font-orbitron font-bold text-white text-sm sm:text-base">ROOK<span className="text-yellow-400">13</span></span>
                </div>
                <div className="flex items-center gap-2">
                    {game.trump && (
                        <span className={`px-2 py-0.5 rounded-full text-white text-[11px] font-orbitron font-bold ${suitChipColors[game.trump]}`}>
                            {game.trump.toUpperCase()}
                        </span>
                    )}
                    {game.highBid && game.bidWinner && (
                        <span className="px-2 py-0.5 rounded-full bg-sky-700 text-white text-[11px] font-orbitron">
                            {game.highBid} · {game.seats[game.bidWinner].name.split(' ')[0]}
                        </span>
                    )}
                </div>
                <button onClick={() => setShowScores(true)} className="flex items-center gap-2 font-orbitron text-sm" title="Score sheet">
                    <span className="text-sky-300 font-bold">{game.scores.A}</span>
                    <span className="text-white/40 text-xs">·</span>
                    <span className="text-orange-300 font-bold">{game.scores.B}</span>
                    <span className="material-symbols-outlined text-white/70 text-lg">receipt_long</span>
                </button>
            </header>

            {mySeat === null && (
                <div className="bg-navy-800/90 text-center text-white/90 text-xs font-orbitron py-1">
                    <span className="material-symbols-outlined text-sm align-middle mr-1">visibility</span>
                    Spectating
                </div>
            )}

            {/* table */}
            <main className="flex-1 relative flex items-center justify-center min-h-0">
                {/* partner (top) */}
                <div className="absolute top-2 left-1/2 -translate-x-1/2">{badge(pos.top)}</div>
                {/* left + right opponents */}
                <div className="absolute left-2 top-1/2 -translate-y-1/2">{badge(pos.left)}</div>
                <div className="absolute right-2 top-1/2 -translate-y-1/2">{badge(pos.right)}</div>

                <TrickArea game={game} bottomSeat={bottomSeat} trump={game.trump} message={centerMessage} />

                {/* widow stack during bidding */}
                {game.phase === 'bidding' && game.widow.length > 0 && (
                    <div className="absolute bottom-3 right-3 flex flex-col items-center">
                        <div className="flex -space-x-6">
                            {game.widow.map((_, i) => <PlayingCard key={i} faceDown size="xs" />)}
                        </div>
                        <span className="text-green-100/50 text-[10px] font-orbitron mt-1">WIDOW</span>
                    </div>
                )}

                {/* go-down stack (bid winner can peek at their own) */}
                {game.goDown.length > 0 && game.phase === 'playing' && (
                    <button
                        className="absolute bottom-3 right-3 flex flex-col items-center"
                        onClick={() => iAmBidWinner && setGoDownPeek((v) => !v)}
                    >
                        <div className="flex -space-x-6">
                            {game.goDown.map((c, i) => (
                                <PlayingCard
                                    key={i}
                                    card={goDownPeek && iAmBidWinner ? c : undefined}
                                    faceDown={!(goDownPeek && iAmBidWinner)}
                                    size="xs"
                                />
                            ))}
                        </div>
                        <span className="text-green-100/50 text-[10px] font-orbitron mt-1">GO-DOWN</span>
                    </button>
                )}

                {/* my badge floats above my hand on larger screens; on phones the hand is identity enough */}
                <div className="absolute bottom-2 left-3 hidden sm:block">{badge(pos.bottom, true)}</div>
            </main>

            {/* dock + hand */}
            <footer className="bg-green-950/50 border-t border-green-700/40 pb-[env(safe-area-inset-bottom)]">
                {actionError && (
                    <div className="text-center text-red-300 text-xs font-orbitron pt-1">{actionError}</div>
                )}
                <ActionDock
                    game={game}
                    mySeat={mySeat}
                    selectedGoDown={selectedGoDown}
                    onAct={act}
                    onConfirmGoDown={() => {
                        if (mySeat && selectedGoDown.length === 4) {
                            act({ type: 'SELECT_GODOWN', seat: mySeat, cards: selectedGoDown });
                        }
                    }}
                />
                {mySeat && (
                    <MyHand
                        game={game}
                        seat={mySeat}
                        selecting={selectingGoDown}
                        selected={selectedGoDown}
                        onToggleSelect={toggleGoDown}
                        onPlay={(card) => act({ type: 'PLAY_CARD', seat: mySeat, card })}
                    />
                )}
            </footer>

            {/* overlays */}
            {game.phase === 'redeal' && <RedealOverlay game={game} mySeat={mySeat} onAct={act} />}
            {game.phase === 'hand_done' && !showScores && (
                <HandRecapModal
                    game={game}
                    onNextHand={() => act({ type: 'NEXT_HAND' })}
                    onShowScores={() => setShowScores(true)}
                />
            )}
            {game.phase === 'game_over' && !showScores && (
                <GameOverOverlay game={game} mySeat={mySeat} onShowScores={() => setShowScores(true)} />
            )}
            {showScores && <ScoreSheetModal game={game} onClose={() => setShowScores(false)} />}
        </div>
    );
}
