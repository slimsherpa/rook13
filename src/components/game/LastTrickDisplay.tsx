'use client';

import { Card as CardType, Seat, GameState } from '@/lib/types/game';
import Card from './Card';
import { calculatePoints } from '@/lib/utils/cardUtils';

interface LastTrickDisplayProps {
    lastTrick: Record<Seat, CardType | null>;
    winner: Seat | null;
    players: GameState['players'];
    tricks: { A: number; B: number };
    handScores: { A: number; B: number };
    playOrder: Seat[];
}

// Helper function to get the next seat in clockwise order
const getNextSeat = (currentSeat: Seat): Seat => {
    const seats: Seat[] = ['A1', 'B1', 'A2', 'B2'];
    const currentIndex = seats.indexOf(currentSeat);
    return seats[(currentIndex + 1) % 4];
};

export default function LastTrickDisplay({ 
    lastTrick, 
    winner, 
    players, 
    tricks, 
    handScores,
    playOrder 
}: LastTrickDisplayProps) {
    // Calculate points in the trick
    const trickPoints = calculatePoints(Object.values(lastTrick).filter((card): card is CardType => card !== null));

    // Get the lead seat (first card played)
    const leadSeat = playOrder[0];
    
    // Create display order starting from lead seat
    const displayOrder: Seat[] = [];
    if (leadSeat) {
        let currentSeat = leadSeat;
        for (let i = 0; i < 4; i++) {
            displayOrder.push(currentSeat);
            currentSeat = getNextSeat(currentSeat);
        }
    }

    return (
        <div className="fixed top-4 right-4 bg-green-900 p-6 rounded-xl shadow-2xl border border-green-700">
            <div className="flex flex-col gap-4">
                {/* Header */}
                <div className="flex justify-between items-center">
                    <h3 className="text-xl font-orbitron font-bold text-white">Last Trick</h3>
                </div>

                {/* Cards Display */}
                <div className="flex justify-center gap-3 py-2">
                    {displayOrder.map((seat, index) => (
                        <div 
                            key={seat} 
                            className={`
                                flex flex-col items-center
                                ${winner === seat ? 'relative' : ''}
                            `}
                        >
                            {/* Play Order Indicator */}
                            <div className={`
                                text-xs font-medium mb-1 px-2 py-0.5 rounded-md w-12 text-center
                                ${index === 0 
                                    ? 'bg-yellow-600 text-yellow-100' 
                                    : 'bg-gray-700 text-gray-200'}
                            `}>
                                {index === 0 ? 'Lead' : `${index + 1}`}
                            </div>

                            {/* Player Name */}
                            <div className={`
                                text-sm font-bold mb-2 px-3 py-1 rounded-lg whitespace-nowrap
                                ${winner === seat 
                                    ? 'bg-green-600 text-white font-orbitron' 
                                    : 'bg-gray-700/80 text-white font-orbitron'}
                            `}>
                                {players[seat]?.name ? players[seat]?.name.split(' ')[0] : '-'}
                            </div>

                            {/* Card */}
                            <div className="transform scale-[0.85] origin-top">
                                {lastTrick[seat] ? (
                                    <Card 
                                        card={lastTrick[seat]!} 
                                        disabled={true}
                                        highlight={winner === seat}
                                    />
                                ) : (
                                    <div className="w-16 h-24 border-2 border-dashed border-white/20 rounded-lg" />
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Winner Banner */}
                {winner && (
                    <div className="bg-green-600 rounded-lg py-2 px-3">
                        <div className="flex items-center justify-center gap-2">
                            <span className="material-symbols-outlined text-yellow-300">
                                stars
                            </span>
                            <span className="font-orbitron font-bold text-white">
                                {players[winner]?.name ? players[winner].name.split(' ')[0] : ''} won {trickPoints} points!
                            </span>
                        </div>
                    </div>
                )}

                {/* Team Scores */}
                <div className="grid grid-cols-2 gap-4 mt-2">
                    {/* Team A */}
                    <div className="bg-blue-800 rounded-lg p-3 border border-blue-700">
                        <div className="text-sm font-orbitron text-blue-200 mb-1">Team A</div>
                        <div className="flex items-center gap-2">
                            <div className="text-xl font-bold text-white">{handScores.A}</div>
                            <div className="text-blue-200 text-sm">pts</div>
                            <div className="flex items-center gap-1 ml-auto">
                                <span className="material-symbols-outlined text-yellow-400">raven</span>
                                <span className="text-yellow-400 font-orbitron font-bold">×{tricks.A}</span>
                            </div>
                        </div>
                    </div>

                    {/* Team B */}
                    <div className="bg-red-800 rounded-lg p-3 border border-red-700">
                        <div className="text-sm font-orbitron text-red-200 mb-1">Team B</div>
                        <div className="flex items-center gap-2">
                            <div className="text-xl font-bold text-white">{handScores.B}</div>
                            <div className="text-red-200 text-sm">pts</div>
                            <div className="flex items-center gap-1 ml-auto">
                                <span className="material-symbols-outlined text-yellow-400">raven</span>
                                <span className="text-yellow-400 font-orbitron font-bold">×{tricks.B}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
} 