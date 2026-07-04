'use client';

// Shown when a hand finishes (phase 'hand_done'): who bid what, who took
// what, the go-down reveal, and the running score. Any player can start the
// next hand.

import { GameDoc, teamOf } from '@/lib/game/types';
import PlayingCard from '@/components/ui/PlayingCard';

interface HandRecapModalProps {
    game: GameDoc;
    onNextHand: () => void;
    onShowScores: () => void;
}

export default function HandRecapModal({ game, onNextHand, onShowScores }: HandRecapModalProps) {
    const h = game.handHistory[game.handHistory.length - 1];
    if (!h) return null;

    const bidTeam = teamOf(h.bidWinner);
    const bidderName = game.seats[h.bidWinner].name.split(' ')[0];
    const lastTrick = game.completedTricks[game.completedTricks.length - 1];
    const goDownTeam = lastTrick ? teamOf(lastTrick.winner) : bidTeam;

    const teamLabel = (t: 'A' | 'B') =>
        t === 'A'
            ? `${game.seats.A1.name.split(' ')[0]} & ${game.seats.A2.name.split(' ')[0]}`
            : `${game.seats.B1.name.split(' ')[0]} & ${game.seats.B2.name.split(' ')[0]}`;

    return (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-green-950 border border-green-700 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                {/* headline */}
                <div className={`px-5 py-4 text-center ${h.wentSet ? 'bg-red-900/60' : 'bg-green-800/60'}`}>
                    <div className="font-orbitron text-white text-xl font-bold">
                        {h.wentSet ? `${bidderName} went SET!` : `${bidderName} made the bid!`}
                    </div>
                    <div className="text-green-100/80 text-sm mt-1 font-orbitron">
                        Bid {h.bid} · took {h.pointsTaken[bidTeam]} · trump {h.trump}
                    </div>
                </div>

                <div className="px-5 py-4 space-y-4">
                    {/* team results */}
                    <div className="grid grid-cols-2 gap-3">
                        {(['A', 'B'] as const).map((t) => (
                            <div key={t} className={`rounded-xl p-3 text-center border ${t === bidTeam ? 'border-yellow-500/50' : 'border-green-800'} bg-green-900/40`}>
                                <div className={`font-orbitron text-xs truncate ${t === 'A' ? 'text-sky-300' : 'text-orange-300'}`}>
                                    {teamLabel(t)}
                                </div>
                                <div className={`font-orbitron text-2xl font-bold ${h.handScore[t] < 0 ? 'text-red-400' : 'text-white'}`}>
                                    {h.handScore[t] >= 0 ? '+' : ''}{h.handScore[t]}
                                </div>
                                <div className="text-green-100/60 text-[11px]">
                                    {h.tricksWon[t]} tricks{h.tricksWon[t] >= 5 ? ' · +20 bonus' : ''}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* go-down reveal */}
                    <div className="flex items-center justify-between rounded-xl bg-green-900/40 border border-green-800 p-3">
                        <div>
                            <div className="text-green-100/80 font-orbitron text-xs">Go-Down · {h.goDownPoints} pts</div>
                            <div className="text-green-100/50 text-[11px]">to {teamLabel(goDownTeam)} (last trick)</div>
                        </div>
                        <div className="flex gap-1">
                            {game.goDown.map((c) => (
                                <PlayingCard key={`${c.suit}-${c.number}`} card={c} trump={game.trump} size="xs" />
                            ))}
                        </div>
                    </div>

                    {/* running totals */}
                    <div className="flex items-center justify-center gap-6 font-orbitron">
                        <div className="text-sky-300 text-lg font-bold">{game.scores.A}</div>
                        <div className="text-green-100/40 text-xs">GAME SCORE</div>
                        <div className="text-orange-300 text-lg font-bold">{game.scores.B}</div>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={onShowScores}
                            className="flex-1 py-3 rounded-xl bg-green-800 hover:bg-green-700 text-white font-orbitron text-sm"
                        >
                            Score Sheet
                        </button>
                        <button
                            onClick={onNextHand}
                            className="flex-[2] py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-orbitron text-sm font-bold active:scale-95 transition"
                        >
                            Next Hand →
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
