'use client';

// The "what just happened" panel, straight from v1: the previous trick laid
// out in play order (Lead, 2, 3, 4), the winner glowing, and the current
// hand's running score for both teams with trick counts. Docked on desktop,
// opened from the header on phones.

import { GameDoc } from '@/lib/game/types';
import PlayingCard from '@/components/ui/PlayingCard';

interface LastTrickPanelProps {
    game: GameDoc;
    onClose?: () => void; // present in the mobile overlay
}

export default function LastTrickPanel({ game, onClose }: LastTrickPanelProps) {
    const trick = game.completedTricks[game.completedTricks.length - 1];
    if (!trick) return null;

    const winnerName = game.seats[trick.winner].name.split(' ')[0];

    const teamBox = (team: 'A' | 'B') => (
        <div className={`flex-1 rounded-xl p-3 ${team === 'A' ? 'bg-sky-900/70 border border-sky-500/40' : 'bg-orange-900/60 border border-orange-500/40'}`}>
            <div className={`font-orbitron text-xs ${team === 'A' ? 'text-sky-300' : 'text-orange-300'}`}>Team {team}</div>
            <div className="flex items-end justify-between mt-1">
                <div className="text-white font-orbitron">
                    <span className="text-xl font-bold">{game.pointsTaken[team]}</span>
                    <span className="text-[10px] text-white/60 ml-1">pts</span>
                </div>
                <div className="flex items-center gap-0.5 text-yellow-400" title={`Tricks won`}>
                    <span className="material-symbols-outlined text-base">raven</span>
                    <span className="font-orbitron text-sm font-bold">×{game.tricksWon[team]}</span>
                </div>
            </div>
        </div>
    );

    return (
        <div className="bg-green-950/95 border border-green-700 rounded-2xl shadow-2xl p-4 w-full max-w-sm">
            <div className="flex items-center justify-between mb-3">
                <h3 className="font-orbitron text-white text-base">Last Trick</h3>
                {onClose && (
                    <button onClick={onClose} className="text-white/60 hover:text-white">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                )}
            </div>

            {/* plays in order */}
            <div className="grid grid-cols-4 gap-2">
                {trick.plays.map(({ seat, card }, i) => {
                    const isWinner = seat === trick.winner;
                    return (
                        <div key={seat} className="flex flex-col items-center gap-1">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-orbitron ${i === 0 ? 'bg-yellow-500 text-green-950 font-bold' : 'bg-gray-800 text-gray-300'}`}>
                                {i === 0 ? 'Lead' : i + 1}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-[11px] font-orbitron max-w-full truncate ${isWinner ? 'bg-green-600 text-white font-bold' : 'bg-gray-800/80 text-gray-200'}`}>
                                {game.seats[seat].name.split(' ')[0]}
                            </span>
                            <PlayingCard card={card} trump={game.trump} size="sm" highlight={isWinner} />
                        </div>
                    );
                })}
            </div>

            {/* winner banner */}
            <div className="mt-3 rounded-xl bg-green-600 text-white text-center py-2 font-orbitron text-sm flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-yellow-300 text-lg">stars</span>
                {winnerName} won {trick.points} point{trick.points === 1 ? '' : 's'}!
            </div>

            {/* current hand score */}
            <div className="flex gap-2 mt-3">
                {teamBox('A')}
                {teamBox('B')}
            </div>
        </div>
    );
}
