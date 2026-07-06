'use client';

import { useRouter } from 'next/navigation';
import { GameDoc, Seat, teamOf } from '@/lib/game/types';

interface GameOverOverlayProps {
    game: GameDoc;
    mySeat: Seat | null;
    onShowScores: () => void;
}

export default function GameOverOverlay({ game, mySeat, onShowScores }: GameOverOverlayProps) {
    const router = useRouter();
    if (!game.winner) return null;

    const iWon = mySeat !== null && teamOf(mySeat) === game.winner;
    const winnerNames = game.winner === 'A'
        ? `${game.seats.A1.name.split(' ')[0]} & ${game.seats.A2.name.split(' ')[0]}`
        : `${game.seats.B1.name.split(' ')[0]} & ${game.seats.B2.name.split(' ')[0]}`;

    return (
        <div className="fixed inset-0 z-40 bg-black/75 backdrop-blur flex flex-col items-center justify-center p-6 text-center">
            <span className={`material-symbols-outlined text-7xl ${iWon ? 'text-yellow-400 animate-bounce' : 'text-white/60'}`}>
                {iWon ? 'trophy' : 'sentiment_calm'}
            </span>
            <h1 className="font-orbitron text-3xl sm:text-4xl font-black text-white mt-3">
                {mySeat === null ? `Team ${game.winner} wins!` : iWon ? 'VICTORY!' : 'Defeat…'}
            </h1>
            <p className="text-white/80 font-orbitron mt-2">
                {winnerNames} take the game
            </p>
            <div className="flex items-center gap-6 mt-5 font-orbitron">
                <div className={`text-3xl font-bold ${game.winner === 'A' ? 'text-yellow-400' : 'text-white/70'}`}>{game.scores.A}</div>
                <div className="text-white/40 text-sm">FINAL</div>
                <div className={`text-3xl font-bold ${game.winner === 'B' ? 'text-yellow-400' : 'text-white/70'}`}>{game.scores.B}</div>
            </div>
            <p className="text-white/50 text-xs mt-2 font-orbitron">{game.handHistory.length} hands played</p>
            <div className="flex flex-wrap justify-center gap-3 mt-6">
                <button
                    onClick={onShowScores}
                    className="px-5 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-orbitron text-sm"
                >
                    Score Sheet
                </button>
                <button
                    onClick={() => router.push(`/review?id=${game.id}`)}
                    className="px-5 py-3 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-navy-950 font-orbitron text-sm font-bold"
                >
                    Review Game
                </button>
                <button
                    onClick={() => router.push('/')}
                    className="px-5 py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-orbitron text-sm font-bold"
                >
                    Back to Lobby
                </button>
            </div>
        </div>
    );
}
