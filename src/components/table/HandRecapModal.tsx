'use client';

// Shown when a hand finishes (phase 'hand_done'): who bid what, who took
// what, the go-down reveal, the running score — and the full trick-by-trick
// review the family loved in v1: every trick in play order with the winner
// glowing, plus the go-down row at the bottom. Any player can start the
// next hand.

import { GameDoc, teamOf, getCardPoints } from '@/lib/game/types';
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
            <div className="bg-navy-950 border border-white/15 rounded-2xl shadow-2xl w-full max-w-md max-h-[90dvh] flex flex-col overflow-hidden">
                {/* headline */}
                <div className={`px-5 py-4 text-center flex-shrink-0 ${h.wentSet ? 'bg-red-900/60' : 'bg-green-800/60'}`}>
                    <div className="font-orbitron text-white text-xl font-bold">
                        {h.wentSet ? `${bidderName} went SET!` : `${bidderName} made the bid!`}
                    </div>
                    <div className="text-green-100/80 text-sm mt-1 font-orbitron">
                        Bid {h.bid} · took {h.pointsTaken[bidTeam]} · trump {h.trump}
                    </div>
                </div>

                <div className="px-5 py-4 space-y-4 overflow-y-auto custom-scrollbar">
                    {/* team results */}
                    <div className="grid grid-cols-2 gap-3">
                        {(['A', 'B'] as const).map((t) => (
                            <div key={t} className={`rounded-xl p-3 text-center border ${t === bidTeam ? 'border-yellow-500/50' : 'border-white/10'} bg-white/5`}>
                                <div className={`font-orbitron text-xs truncate ${t === 'A' ? 'text-sky-300' : 'text-orange-300'}`}>
                                    {teamLabel(t)}
                                </div>
                                <div className={`font-orbitron text-2xl font-bold ${h.handScore[t] < 0 ? 'text-red-400' : 'text-white'}`}>
                                    {h.handScore[t] >= 0 ? '+' : ''}{h.handScore[t]}
                                </div>
                                <div className="text-green-100/60 text-[11px] flex items-center justify-center gap-1.5">
                                    <span>{h.tricksWon[t]} trick{h.tricksWon[t] === 1 ? '' : 's'}</span>
                                    {h.tricksWon[t] >= 5 && (
                                        <span className="px-1.5 py-px rounded bg-yellow-500/20 text-yellow-300 font-orbitron">+20</span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* go-down reveal */}
                    <div className="flex items-center justify-between rounded-xl bg-white/5 border border-white/10 p-3">
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
                            className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-orbitron text-sm"
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

                    {/* trick-by-trick review, straight from v1 */}
                    <div className="pt-2 border-t border-white/10">
                        <div className="text-green-100/50 font-orbitron text-[11px] uppercase tracking-widest mb-3">
                            Trick by trick
                        </div>
                        <div className="space-y-4">
                            {game.completedTricks.map((trick, idx) => (
                                <div key={idx} className="flex items-center gap-2">
                                    <div className="w-7 flex-shrink-0 text-green-100/40 font-orbitron text-2xl font-bold text-center">
                                        {idx + 1}
                                    </div>
                                    <div className="grid grid-cols-4 gap-1.5 flex-1">
                                        {trick.plays.map(({ seat, card }) => {
                                            const isWinner = seat === trick.winner;
                                            return (
                                                <div key={seat} className="flex flex-col items-center gap-1">
                                                    <span className={`px-1.5 py-px rounded text-[10px] font-orbitron max-w-full truncate ${isWinner ? 'bg-yellow-500/20 text-yellow-300 font-bold' : 'text-green-100/60'}`}>
                                                        {game.seats[seat].name.split(' ')[0]}
                                                    </span>
                                                    <PlayingCard card={card} trump={game.trump} size="sm" highlight={isWinner} />
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                            {/* the go-down, revealed at the end like v1 */}
                            <div className="flex items-center gap-2">
                                <div className="w-7 flex-shrink-0 text-green-100/40 font-orbitron text-xs font-bold text-center">
                                    GD
                                </div>
                                <div className="grid grid-cols-4 gap-1.5 flex-1">
                                    {game.goDown.map((c) => (
                                        <div key={`${c.suit}-${c.number}`} className="flex flex-col items-center gap-1">
                                            <span className={`px-1.5 py-px rounded text-[10px] font-orbitron ${getCardPoints(c) > 0 ? 'text-yellow-300' : 'text-green-100/40'}`}>
                                                {getCardPoints(c) > 0 ? `${getCardPoints(c)} pts` : '—'}
                                            </span>
                                            <PlayingCard card={c} trump={game.trump} size="sm" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
