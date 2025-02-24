import { Card as CardType, Seat, GameState } from '@/lib/types/game';
import Card from './Card';
import { calculatePoints } from '@/lib/utils/cardUtils';
import { useGameStore } from '@/lib/store/gameStore';

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
}

export default function HandRecap({ isOpen, onClose, tricks, goDown, players, bidWinner, currentBid }: HandRecapProps) {
    const { game } = useGameStore();

    const handleClose = () => {
        onClose();
        // The game state should already be in 'dealing' phase with the new dealer
        // Just need to close the modal and let the game continue
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

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-green-900 p-4 rounded-xl shadow-2xl border border-green-700 w-[500px] max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-orbitron font-bold text-white">Hand Recap</h2>
                    <button 
                        onClick={handleClose}
                        className="text-white/80 hover:text-white"
                    >
                        <span className="material-symbols-outlined">close</span>
                    </button>
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

                        {/* Points Breakdown */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-blue-900/30 p-3 rounded-lg">
                                <div className="text-blue-200 font-orbitron text-sm">Team A Points</div>
                                <div className="text-xl font-bold text-white">{teamPoints.A}</div>
                                <div className="text-blue-200/80 text-sm">
                                    {trickCounts.A} tricks {trickCounts.A >= 5 ? '(+20 bonus)' : ''}
                                </div>
                            </div>
                            <div className="bg-red-900/30 p-3 rounded-lg">
                                <div className="text-red-200 font-orbitron text-sm">Team B Points</div>
                                <div className="text-xl font-bold text-white">{teamPoints.B}</div>
                                <div className="text-red-200/80 text-sm">
                                    {trickCounts.B} tricks {trickCounts.B >= 5 ? '(+20 bonus)' : ''}
                                </div>
                            </div>
                        </div>

                        {/* Score Card */}
                        <div className="mt-2">
                            <table className="w-full text-white">
                                <thead className="text-sm font-orbitron bg-green-950/50">
                                    <tr>
                                        <th className="px-3 py-2 text-left">Hand</th>
                                        <th className="px-3 py-2 text-left">Winner</th>
                                        <th className="px-3 py-2 text-right">Bid</th>
                                        <th className="px-3 py-2 text-right">Team A</th>
                                        <th className="px-3 py-2 text-right">Team B</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-green-800/30 text-sm">
                                    <tr>
                                        <td className="px-3 py-2">1</td>
                                        <td className="px-3 py-2">{players[bidWinner]?.name}</td>
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
                                        <td className="px-3 py-2 text-right">
                                            {bidWinnerTeam === 'A' ? handScore : teamPoints.A}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            {bidWinnerTeam === 'B' ? handScore : teamPoints.B}
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
                                                {players[seat]?.name}
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
                                                {/* Extra glow effect for winning card */}
                                                {seat === trick.winner && (
                                                    <div className="absolute inset-0 rounded-lg bg-yellow-400/5 shadow-[0_0_12px_4px_rgba(234,179,8,0.3)] pointer-events-none" />
                                                )}
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