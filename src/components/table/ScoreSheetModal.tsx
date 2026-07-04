'use client';

// Hand-by-hand score sheet, styled like the paper one the family keeps.

import { GameDoc, teamOf } from '@/lib/game/types';

interface ScoreSheetModalProps {
    game: GameDoc;
    onClose: () => void;
}

export default function ScoreSheetModal({ game, onClose }: ScoreSheetModalProps) {
    let runningA = 0;
    let runningB = 0;
    const rows = game.handHistory.map((h) => {
        runningA += h.handScore.A;
        runningB += h.handScore.B;
        return { ...h, totalA: runningA, totalB: runningB };
    });

    const teamNames = {
        A: `${game.seats.A1.name.split(' ')[0]} & ${game.seats.A2.name.split(' ')[0]}`,
        B: `${game.seats.B1.name.split(' ')[0]} & ${game.seats.B2.name.split(' ')[0]}`,
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="bg-green-950 border border-green-700 rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-4 border-b border-green-800">
                    <h2 className="font-orbitron text-white text-lg">Score Sheet</h2>
                    <button onClick={onClose} className="text-white/60 hover:text-white">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="px-5 py-3 grid grid-cols-2 gap-3 border-b border-green-800">
                    <div className="text-center">
                        <div className="text-sky-300 font-orbitron text-xs truncate">{teamNames.A}</div>
                        <div className="text-white font-orbitron text-2xl font-bold">{game.scores.A}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-orange-300 font-orbitron text-xs truncate">{teamNames.B}</div>
                        <div className="text-white font-orbitron text-2xl font-bold">{game.scores.B}</div>
                    </div>
                </div>

                <div className="overflow-y-auto custom-scrollbar">
                    {rows.length === 0 ? (
                        <div className="text-green-100/60 text-sm text-center py-8">No hands scored yet.</div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-green-100/60 font-orbitron text-[10px] uppercase">
                                    <th className="py-2 pl-4 text-left">#</th>
                                    <th className="text-left">Bid</th>
                                    <th className="text-right">A</th>
                                    <th className="text-right pr-2">Σ</th>
                                    <th className="text-right">B</th>
                                    <th className="text-right pr-4">Σ</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => {
                                    const bidTeam = teamOf(r.bidWinner);
                                    return (
                                        <tr key={r.handNumber} className="border-t border-green-800/50 text-white">
                                            <td className="py-2 pl-4 text-green-100/70">{r.handNumber}</td>
                                            <td>
                                                <span className={`font-orbitron font-bold ${r.wentSet ? 'text-red-400' : 'text-green-300'}`}>
                                                    {r.bid}
                                                </span>
                                                <span className="text-green-100/60 text-xs"> {game.seats[r.bidWinner].name.split(' ')[0]}</span>
                                                {r.wentSet && <span className="text-red-400 text-xs font-orbitron"> SET</span>}
                                            </td>
                                            <td className={`text-right ${bidTeam === 'A' && r.wentSet ? 'text-red-400' : ''}`}>{r.handScore.A}</td>
                                            <td className="text-right pr-2 font-bold">{r.totalA}</td>
                                            <td className={`text-right ${bidTeam === 'B' && r.wentSet ? 'text-red-400' : ''}`}>{r.handScore.B}</td>
                                            <td className="text-right pr-4 font-bold">{r.totalB}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}
