'use client';

// The score sheet, in the format the family has kept on paper for decades:
// hand number, dealer, who took it and for how much, then each team's score
// for the hand — with the running totals summed at the bottom. Also carries
// the table code + share link so anyone can invite spectators mid-game.

import { useState } from 'react';
import { GameDoc, teamOf } from '@/lib/game/types';

interface ScoreSheetModalProps {
    game: GameDoc;
    onClose: () => void;
}

export default function ScoreSheetModal({ game, onClose }: ScoreSheetModalProps) {
    const [copied, setCopied] = useState(false);
    const teamNames = {
        A: `${game.seats.A1.name.split(' ')[0]} & ${game.seats.A2.name.split(' ')[0]}`,
        B: `${game.seats.B1.name.split(' ')[0]} & ${game.seats.B2.name.split(' ')[0]}`,
    };

    // bare URL only (same rule as the lobby share): prose in the clipboard
    // mangles links in chats that join lines
    const shareWatchLink = async () => {
        const url = `${window.location.origin}/game?id=${game.id}`;
        if (navigator.share) {
            try {
                await navigator.share({ title: `Watch Rook13 — table ${game.joinCode}`, url });
                return;
            } catch { /* user cancelled; fall through to clipboard */ }
        }
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div
                // overflow-hidden keeps the sticky totals row inside the rounded corners
                className="bg-navy-950 border border-white/15 rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                    <h2 className="font-orbitron text-white text-lg">Score Sheet</h2>
                    <button onClick={onClose} className="text-white/60 hover:text-white">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="overflow-y-auto custom-scrollbar flex-1">
                    {game.handHistory.length === 0 ? (
                        <div className="text-white/60 text-sm text-center py-8">No hands scored yet.</div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-navy-950">
                                <tr className="text-white/60 font-orbitron text-[10px] uppercase">
                                    <th className="py-2 pl-4 text-left">#</th>
                                    <th className="text-left">Dealer</th>
                                    <th className="text-left">Took It</th>
                                    <th className="text-right text-sky-300 normal-case">{teamNames.A}</th>
                                    <th className="text-right pr-4 text-orange-300 normal-case">{teamNames.B}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {game.handHistory.map((h) => {
                                    const bidTeam = teamOf(h.bidWinner);
                                    return (
                                        <tr key={h.handNumber} className="border-t border-white/10 text-white">
                                            <td className="py-2.5 pl-4 text-white/70">{h.handNumber}</td>
                                            <td className="text-white/80">{game.seats[h.dealer].name.split(' ')[0]}</td>
                                            <td>
                                                <span className="text-white/90">{game.seats[h.bidWinner].name.split(' ')[0]} </span>
                                                <span className={`font-orbitron font-bold ${h.wentSet ? 'text-red-400' : 'text-white'}`}>
                                                    {h.bid}
                                                </span>
                                                {h.wentSet && <span className="text-red-400 text-[10px] font-orbitron"> SET</span>}
                                            </td>
                                            <td className={`text-right font-semibold ${bidTeam === 'A' && h.wentSet ? 'text-red-400' : ''}`}>
                                                {h.handScore.A}
                                            </td>
                                            <td className={`text-right pr-4 font-semibold ${bidTeam === 'B' && h.wentSet ? 'text-red-400' : ''}`}>
                                                {h.handScore.B}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot className="sticky bottom-0 bg-navy-800">
                                <tr className="border-t-2 border-white/25 text-white font-orbitron">
                                    <td colSpan={3} className="py-3 pl-4 text-white/70 text-xs uppercase tracking-widest">Total</td>
                                    <td className={`text-right text-xl font-bold ${game.scores.A < 0 ? 'text-red-400' : 'text-sky-300'}`}>
                                        {game.scores.A}
                                    </td>
                                    <td className={`text-right pr-4 text-xl font-bold ${game.scores.B < 0 ? 'text-red-400' : 'text-orange-300'}`}>
                                        {game.scores.B}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    )}
                </div>

                {/* invite spectators */}
                <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-white/10 bg-white/5 flex-shrink-0">
                    <div className="min-w-0">
                        <div className="text-white/60 text-[10px] font-orbitron uppercase tracking-widest">Watch this game</div>
                        <div className="font-code text-yellow-400 text-xl leading-tight">{game.joinCode}</div>
                    </div>
                    <button
                        onClick={shareWatchLink}
                        className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-orbitron text-xs inline-flex items-center gap-2 flex-shrink-0"
                    >
                        <span className="material-symbols-outlined text-base">ios_share</span>
                        {copied ? 'Copied!' : 'Share Link'}
                    </button>
                </div>
            </div>
        </div>
    );
}
