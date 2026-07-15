'use client';

// The kickoff card: "Team A vs Team B — Go!", shown once when a game starts
// so everybody knows who's partnered with whom before the first bid. Sky is
// always Team A (seats A1/A2), orange Team B (B1/B2), matching the badges,
// the score header, and the last-trick panel. Device-local and self-timed —
// it fades itself out; tapping skips it.

import { useEffect, useState } from 'react';
import { GameDoc } from '@/lib/game/types';
import { paced } from '@/lib/settings';

const HOLD_MS = 2600;

export default function TeamIntro({ game, onDone }: { game: GameDoc; onDone: () => void }) {
    const [go, setGo] = useState(false);
    useEffect(() => {
        const t1 = setTimeout(() => setGo(true), paced(1400));
        const t2 = setTimeout(onDone, paced(HOLD_MS));
        return () => { clearTimeout(t1); clearTimeout(t2); };
    }, [onDone]);

    const first = (seat: 'A1' | 'A2' | 'B1' | 'B2') => game.seats[seat].name.split(' ')[0];

    const teamCard = (
        side: 'left' | 'right',
        label: string,
        p1: string,
        p2: string,
        ring: string,
        text: string,
        glow: string,
    ) => (
        <div
            className={`flex-1 rounded-2xl border-2 ${ring} bg-black/70 px-4 py-5 text-center shadow-2xl ${glow} ${
                side === 'left' ? 'animate-team-in-left' : 'animate-team-in-right'
            }`}
        >
            <div className={`font-orbitron text-lg sm:text-2xl font-black ${text}`}>{label}</div>
            <div className="mt-2 space-y-0.5">
                <div className="font-orbitron text-white text-sm sm:text-base truncate">{p1}</div>
                <div className="text-white/40 text-xs font-orbitron">&amp;</div>
                <div className="font-orbitron text-white text-sm sm:text-base truncate">{p2}</div>
            </div>
        </div>
    );

    return (
        <div
            className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-6"
            onClick={onDone}
        >
            <div className="w-full max-w-lg">
                <div className="relative flex items-stretch gap-3 sm:gap-5">
                    {teamCard('left', 'TEAM A', first('A1'), first('A2'),
                        'border-sky-400', 'text-sky-300', 'shadow-[0_0_35px_rgba(56,189,248,0.35)]')}
                    {teamCard('right', 'TEAM B', first('B1'), first('B2'),
                        'border-orange-400', 'text-orange-300', 'shadow-[0_0_35px_rgba(251,146,60,0.35)]')}
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                        <span className="animate-vs-pop inline-block font-orbitron text-3xl sm:text-5xl font-black text-yellow-400 drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">
                            VS
                        </span>
                    </div>
                </div>
                <div className="mt-6 text-center h-14 flex items-center justify-center">
                    {go && (
                        <span className="animate-go-pop inline-block font-orbitron text-4xl sm:text-6xl font-black text-white drop-shadow-[0_0_25px_rgba(234,179,8,0.7)]">
                            GO!
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
