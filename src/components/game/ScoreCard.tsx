import { GameState, Seat } from '@/lib/types/game';

interface HandScore {
    dealer: Seat;
    bidWinner: Seat;
    bid: number;
    teamAScore: number;
    teamBScore: number;
    teamATotal: number;
    teamBTotal: number;
}

interface ScoreCardProps {
    isOpen: boolean;
    onClose: () => void;
    game: GameState;
    handScores: HandScore[];
}

export default function ScoreCard({ isOpen, onClose, game, handScores }: ScoreCardProps) {
    if (!isOpen) return null;

    return (
        <div 
            className="fixed inset-y-0 left-0 w-[600px] bg-green-900/95 backdrop-blur-sm shadow-2xl 
                       transform transition-transform duration-300 ease-in-out z-50
                       border-r border-green-700"
            style={{
                transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
            }}
        >
            {/* Header */}
            <div className="flex justify-between items-center p-6 border-b border-green-700">
                <h2 className="text-2xl font-orbitron font-bold text-white">Score Card</h2>
                <button 
                    onClick={onClose}
                    className="text-white/80 hover:text-white"
                >
                    <span className="material-symbols-outlined">close</span>
                </button>
            </div>

            {/* Score Table */}
            <div className="p-6">
                <div className="overflow-x-auto">
                    <table className="w-full text-white">
                        <thead className="text-sm font-orbitron bg-green-950/50">
                            <tr>
                                <th className="px-3 py-2 text-left">Hand</th>
                                <th className="px-3 py-2 text-left">Dealer</th>
                                <th className="px-3 py-2 text-left">Bid Winner</th>
                                <th className="px-3 py-2 text-right">Winning Bid</th>
                                <th className="px-3 py-2 text-right">Team A</th>
                                <th className="px-3 py-2 text-right">Team B</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-green-800/30">
                            {handScores.map((score, index) => (
                                <tr key={index} className="text-sm">
                                    <td className="px-3 py-2">{index + 1}</td>
                                    <td className="px-3 py-2">{game.players[score.dealer]?.name}</td>
                                    <td className="px-3 py-2">{game.players[score.bidWinner]?.name}</td>
                                    <td className="px-3 py-2 text-right">{score.bid}</td>
                                    <td className="px-3 py-2 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <span>{score.teamAScore >= 0 ? '+' : ''}{score.teamAScore}</span>
                                            <span className="text-xs text-white/60">({score.teamATotal})</span>
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <span>{score.teamBScore >= 0 ? '+' : ''}{score.teamBScore}</span>
                                            <span className="text-xs text-white/60">({score.teamBTotal})</span>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {/* Total row */}
                            <tr className="bg-green-950/50 font-bold">
                                <td colSpan={4} className="px-3 py-2">TOTALS:</td>
                                <td className="px-3 py-2 text-right">
                                    {handScores.length > 0 ? handScores[handScores.length - 1].teamATotal : 0}
                                </td>
                                <td className="px-3 py-2 text-right">
                                    {handScores.length > 0 ? handScores[handScores.length - 1].teamBTotal : 0}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
} 