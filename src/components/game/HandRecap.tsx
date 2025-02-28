import { Card as CardType, Seat, GameState } from '@/lib/types/game';
import Card from './Card';
import { calculatePoints } from '@/lib/utils/cardUtils';
import { useGameStore } from '@/lib/store/gameStore';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface HandScore {
    dealer: Seat;
    bidWinner: Seat;
    bid: number;
    teamAScore: number;
    teamBScore: number;
    teamATotal: number;
    teamBTotal: number;
}

interface HandRecapProps {
    isOpen: boolean;
    onClose: () => void;
    tricks: Array<{
        cards: Record<Seat, CardType>;
        playOrder: Seat[];
        winner: Seat;
    }>;
    goDown: CardType[];
    players: GameState['players'];
    bidWinner: Seat;
    currentBid: number;
    handScores?: HandScore[];
}

export default function HandRecap({ 
    isOpen, 
    onClose, 
    tricks, 
    goDown, 
    players, 
    bidWinner, 
    currentBid,
    handScores = []
}: HandRecapProps) {
    const { game, resetGame } = useGameStore();
    const [confetti, setConfetti] = useState(false);
    const router = useRouter();

    const handleClose = () => {
        onClose();
    };

    const handleReturnToLobby = () => {
        // Reset the game state first
        resetGame();
        // Navigate to the game page which contains the lobby
        router.push('/game');
        // Force a hard refresh to ensure clean state
        router.refresh();
    };

    if (!isOpen) return null;

    // Calculate points for each team
    const teamPoints = tricks.reduce((acc, trick) => {
        const winningTeam = trick.winner.charAt(0) as 'A' | 'B';
        const trickPoints = calculatePoints(Object.values(trick.cards));
        acc[winningTeam] += trickPoints;
        return acc;
    }, { A: 0, B: 0 });

    // Add go-down points to the team that won the last trick
    if (tricks.length > 0) {
        const lastTrickWinner = tricks[tricks.length - 1].winner;
        const winningTeam = lastTrickWinner.charAt(0) as 'A' | 'B';
        teamPoints[winningTeam] += calculatePoints(goDown);
    }

    // Count tricks won by each team
    const trickCounts = tricks.reduce((acc, trick) => {
        const winningTeam = trick.winner.charAt(0) as 'A' | 'B';
        acc[winningTeam]++;
        return acc;
    }, { A: 0, B: 0 });

    // Add 20 point bonus for taking 5 or more tricks
    if (trickCounts.A >= 5) teamPoints.A += 20;
    if (trickCounts.B >= 5) teamPoints.B += 20;

    // Determine if bid winner made their bid
    const bidWinnerTeam = bidWinner.charAt(0) as 'A' | 'B';
    const bidWinnerPoints = teamPoints[bidWinnerTeam];
    const handScore = bidWinnerPoints >= currentBid ? bidWinnerPoints : -currentBid;

    // Get the latest cumulative scores
    const latestScores = handScores.length > 0 
        ? handScores[handScores.length - 1] 
        : { teamATotal: 0, teamBTotal: 0 };
    
    // Check if a team has won the game - fixed according to game rules
    // A team wins if their score > 500 OR opponent's score < -250
    const teamAWins = latestScores.teamATotal > 500 || latestScores.teamBTotal < -250;
    const teamBWins = latestScores.teamBTotal > 500 || latestScores.teamATotal < -250;
    const winningTeam = teamAWins ? 'A' : teamBWins ? 'B' : null;

    // Trigger confetti effect when component mounts if there's a winner
    useEffect(() => {
        if (winningTeam && isOpen) {
            setConfetti(true);
            
            // Disable confetti after 5 seconds to avoid performance issues
            const timer = setTimeout(() => {
                setConfetti(false);
            }, 5000);
            
            return () => clearTimeout(timer);
        }
    }, [winningTeam, isOpen]);

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-green-900 p-4 rounded-xl shadow-2xl border border-green-700 w-[500px] max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-orbitron font-bold text-white">Hand Recap</h2>
                    {/* Only show close button if game is not over */}
                    {!winningTeam && (
                        <button 
                            onClick={handleClose}
                            className="text-white/80 hover:text-white"
                        >
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    )}
                </div>

                {/* Scrollable content with modern scrollbar */}
                <div className="space-y-6 pr-4 max-h-[calc(90vh-8rem)] overflow-y-auto 
                    [&::-webkit-scrollbar]:w-2
                    [&::-webkit-scrollbar-track]:rounded-full
                    [&::-webkit-scrollbar-track]:bg-green-950/30
                    [&::-webkit-scrollbar-thumb]:rounded-full
                    [&::-webkit-scrollbar-thumb]:bg-white/20
                    hover:[&::-webkit-scrollbar-thumb]:bg-white/30
                    [scrollbar-gutter:stable]">
                    
                    {/* Game Winner Celebration - Only shown when a team wins */}
                    {winningTeam && (
                        <div className={`relative overflow-hidden rounded-xl p-6 mb-4 text-center 
                            ${winningTeam === 'A' ? 'bg-blue-900' : 'bg-red-900'}
                            border-4 ${winningTeam === 'A' ? 'border-blue-500' : 'border-red-500'}
                            animate-pulse shadow-[0_0_30px_rgba(255,255,255,0.3)]`}
                        >
                            {/* Animated stars in background */}
                            <div className="absolute inset-0 overflow-hidden">
                                {Array.from({ length: 20 }).map((_, i) => (
                                    <div 
                                        key={i}
                                        className="absolute animate-ping"
                                        style={{
                                            top: `${Math.random() * 100}%`,
                                            left: `${Math.random() * 100}%`,
                                            width: `${Math.random() * 10 + 5}px`,
                                            height: `${Math.random() * 10 + 5}px`,
                                            backgroundColor: winningTeam === 'A' ? 'rgba(59, 130, 246, 0.7)' : 'rgba(239, 68, 68, 0.7)',
                                            borderRadius: '50%',
                                            animationDuration: `${Math.random() * 3 + 1}s`,
                                            animationDelay: `${Math.random() * 2}s`,
                                        }}
                                    />
                                ))}
                            </div>
                            
                            {/* Trophy icon */}
                            <div className="flex justify-center mb-2">
                                <span className="material-symbols-outlined text-yellow-300 text-6xl animate-bounce">
                                    emoji_events
                                </span>
                            </div>
                            
                            {/* Winner text */}
                            <h3 className="text-4xl font-orbitron font-bold text-white mb-2 relative z-10">
                                TEAM {winningTeam} WINS!!!
                            </h3>
                            
                            <p className="text-lg text-white/90 font-medium relative z-10">
                                {winningTeam === 'A' 
                                    ? `${latestScores.teamATotal} to ${latestScores.teamBTotal}` 
                                    : `${latestScores.teamBTotal} to ${latestScores.teamATotal}`}
                            </p>
                            
                            {/* Confetti effect */}
                            {confetti && (
                                <div className="absolute inset-0 pointer-events-none">
                                    {Array.from({ length: 50 }).map((_, i) => (
                                        <div 
                                            key={i}
                                            className="absolute animate-fall"
                                            style={{
                                                top: `-20px`,
                                                left: `${Math.random() * 100}%`,
                                                width: `${Math.random() * 10 + 5}px`,
                                                height: `${Math.random() * 10 + 15}px`,
                                                backgroundColor: ['#FFD700', '#FF6347', '#4169E1', '#32CD32', '#FF69B4'][Math.floor(Math.random() * 5)],
                                                transform: `rotate(${Math.random() * 360}deg)`,
                                                opacity: Math.random() * 0.7 + 0.3,
                                                animationDelay: `${Math.random() * 3}s`,
                                            }}
                                        />
                                    ))}
                                </div>
                            )}

                            {/* Return to Lobby Button */}
                            <button
                                onClick={handleReturnToLobby}
                                className="mt-6 px-8 py-3 bg-yellow-500 hover:bg-yellow-400 
                                         text-black font-orbitron font-bold rounded-xl 
                                         shadow-lg transform transition-all duration-200 
                                         hover:scale-105 relative z-10
                                         flex items-center justify-center gap-2 mx-auto"
                            >
                                <span className="material-symbols-outlined">home</span>
                                Return to Lobby
                            </button>
                        </div>
                    )}
                    
                    {/* Score Recap - Now at the top */}
                    <div className="space-y-4">
                        {/* Bid Result */}
                        <div className="text-center">
                            <div className={`text-2xl font-orbitron font-bold
                                ${handScore >= 0 ? 'text-green-400' : 'text-red-400'}
                            `}>
                                Team {bidWinnerTeam} {handScore >= 0 ? 'made it!' : 'got set!'}
                            </div>
                            <div className="text-white/90 text-base mt-1">
                                {players[bidWinner]?.name} took it for {currentBid} and Team {bidWinnerTeam} captured {bidWinnerPoints} points
                            </div>
                        </div>

                        {/* Points Breakdown - Enhanced with better styling */}
                        <div className="grid grid-cols-2 gap-3">
                            {/* Team A - Enhanced styling - Removed animate-pulse */}
                            <div className={`bg-blue-800 rounded-lg p-3 border shadow-lg
                                ${teamAWins ? 'border-yellow-400 shadow-[0_0_15px_rgba(234,179,8,0.5)]' : 'border-blue-700'}
                            `}>
                                <div className="text-sm font-orbitron text-blue-200 mb-1">Team A Points</div>
                                <div className="flex items-center gap-2">
                                    <div className="text-xl font-bold text-white">{teamPoints.A}</div>
                                    <div className="text-blue-200 text-sm">pts</div>
                                    <div className="flex items-center gap-1 ml-auto">
                                        <span className="material-symbols-outlined text-yellow-400">raven</span>
                                        <span className="text-yellow-400 font-orbitron font-bold">×{trickCounts.A}</span>
                                    </div>
                                </div>
                                {trickCounts.A >= 5 && (
                                    <div className="text-xs text-blue-200 mt-1 bg-blue-700/50 rounded px-2 py-0.5 inline-block">
                                        +20 bonus
                                    </div>
                                )}
                            </div>
                            
                            {/* Team B - Enhanced styling - Removed animate-pulse */}
                            <div className={`bg-red-800 rounded-lg p-3 border shadow-lg
                                ${teamBWins ? 'border-yellow-400 shadow-[0_0_15px_rgba(234,179,8,0.5)]' : 'border-red-700'}
                            `}>
                                <div className="text-sm font-orbitron text-red-200 mb-1">Team B Points</div>
                                <div className="flex items-center gap-2">
                                    <div className="text-xl font-bold text-white">{teamPoints.B}</div>
                                    <div className="text-red-200 text-sm">pts</div>
                                    <div className="flex items-center gap-1 ml-auto">
                                        <span className="material-symbols-outlined text-yellow-400">raven</span>
                                        <span className="text-yellow-400 font-orbitron font-bold">×{trickCounts.B}</span>
                                    </div>
                                </div>
                                {trickCounts.B >= 5 && (
                                    <div className="text-xs text-red-200 mt-1 bg-red-700/50 rounded px-2 py-0.5 inline-block">
                                        +20 bonus
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Score Card - Now showing cumulative scores with updated headers */}
                        <div className="mt-2">
                            <table className="w-full text-white">
                                <thead className="text-sm font-orbitron bg-green-950/50">
                                    <tr>
                                        <th className="px-3 py-2 text-left">Dealer</th>
                                        <th className="px-3 py-2 text-left">Took It</th>
                                        <th className="px-3 py-2 text-right">Bid</th>
                                        <th className="px-3 py-2 text-right">Team A</th>
                                        <th className="px-3 py-2 text-right">Team B</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-green-800/30 text-sm">
                                    <tr>
                                        <td className="px-3 py-2">
                                            {handScores.length > 0 && handScores[handScores.length - 1].dealer ? 
                                                players[handScores[handScores.length - 1].dealer]?.name?.split(' ')[0] || '' : ''}
                                        </td>
                                        <td className="px-3 py-2">{players[bidWinner]?.name?.split(' ')[0] || ''}</td>
                                        <td className="px-3 py-2 text-right">{currentBid}</td>
                                        <td className="px-3 py-2 text-right">
                                            {bidWinnerTeam === 'A' ? handScore : teamPoints.A}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            {bidWinnerTeam === 'B' ? handScore : teamPoints.B}
                                        </td>
                                    </tr>
                                    <tr className="bg-green-950/50 font-bold text-base">
                                        <td colSpan={3} className="px-3 py-2">TOTALS:</td>
                                        <td className={`px-3 py-2 text-right ${teamAWins ? 'text-yellow-300' : ''}`}>
                                            {latestScores.teamATotal}
                                        </td>
                                        <td className={`px-3 py-2 text-right ${teamBWins ? 'text-yellow-300' : ''}`}>
                                            {latestScores.teamBTotal}
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="border-t border-green-800"></div>

                    {/* Tricks - Now at the bottom */}
                    <div className="space-y-3">
                        {tricks.map((trick, index) => (
                            <div key={index} className="flex items-center">
                                {/* Trick number container with fixed width and right margin */}
                                <div className="flex-none w-10 flex justify-end items-center">
                                    <div className="font-orbitron font-bold text-white/80 text-[42px]">
                                        {index + 1}
                                    </div>
                                </div>

                                {/* Cards with player names */}
                                <div className="flex flex-1 justify-center gap-3">
                                    {trick.playOrder.map((seat) => (
                                        <div key={seat} className="flex flex-col items-center">
                                            {/* Player name */}
                                            <div className={`
                                                text-xs mb-1 px-2 py-0.5 rounded text-center
                                                ${seat === trick.winner 
                                                    ? 'bg-yellow-500/20 text-yellow-200 font-medium shadow-[0_0_8px_rgba(234,179,8,0.2)]' 
                                                    : 'text-white/80'}
                                            `}>
                                                {players[seat]?.name ? players[seat].name.split(' ')[0] : ''}
                                            </div>

                                            {/* Card with scale matching Last Trick */}
                                            <div className={`
                                                transform scale-[0.85] origin-top
                                                ${seat === trick.winner ? 'relative' : ''}
                                            `}>
                                                <Card 
                                                    card={trick.cards[seat]} 
                                                    disabled={true}
                                                    highlight={seat === trick.winner}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}

                        {/* Go Down */}
                        <div className="flex items-center">
                            <div className="flex-none w-10 flex justify-end items-center">
                                <div className="font-orbitron font-bold text-white/80 text-sm">
                                    GD
                                </div>
                            </div>
                            <div className="flex flex-1 justify-center gap-3">
                                {goDown.map((card, index) => (
                                    <div key={index} className="transform scale-[0.85] origin-top">
                                        <Card card={card} disabled={true} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
} 