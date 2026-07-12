'use client';

// Table settings, opened from the gear in the game header. Device-local:
// everyone at the table picks the pace of their own screen (bot pacing
// follows the host's device, since the host's client usually wins the race
// to move the bots).

import { GAME_SPEEDS, TablePace, useGameSpeed, useTablePace } from '@/lib/settings';

const PACES: { id: TablePace; label: string; blurb: string; icon: string }[] = [
    { id: 'auto',   label: 'Auto',   blurb: 'Tricks sweep away on their own',                icon: 'play_circle' },
    { id: 'manual', label: 'Manual', blurb: 'Cards stay until you advance — count away',     icon: 'back_hand' },
];

export default function SettingsModal({ onClose }: { onClose: () => void }) {
    const [speed, setSpeed] = useGameSpeed();
    const [pace, setPace] = useTablePace();

    const option = (selected: boolean, icon: string, label: string, blurb: string, onPick: () => void) => (
        <button
            key={label}
            onClick={onPick}
            className={`w-full flex items-center gap-3 rounded-xl border p-2.5 text-left transition ${
                selected
                    ? 'border-sky-400 bg-sky-500/15'
                    : 'border-white/10 bg-white/5 hover:border-white/30'
            }`}
        >
            <span className={`material-symbols-outlined text-xl ${selected ? 'text-sky-300' : 'text-white/50'}`}>
                {icon}
            </span>
            <span className="flex-1 min-w-0">
                <span className={`block font-orbitron text-sm ${selected ? 'text-white font-bold' : 'text-white/85'}`}>
                    {label}
                </span>
                <span className="block text-white/50 text-[11px]">{blurb}</span>
            </span>
            {selected && (
                <span className="material-symbols-outlined text-sky-300 text-lg">check_circle</span>
            )}
        </button>
    );

    return (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-navy-950 border border-white/15 rounded-2xl p-5 w-full max-w-xs max-h-[90dvh] overflow-y-auto custom-scrollbar" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 text-white font-orbitron text-sm mb-1">
                    <span className="material-symbols-outlined text-lg">settings</span>
                    Game Speed
                </div>
                <p className="text-white/50 text-[11px] mb-3 leading-relaxed">
                    Animations and waits on this device — the bots think just as hard at every speed.
                </p>
                <div className="space-y-1.5">
                    {GAME_SPEEDS.map((s) =>
                        option(speed === s.id, s.icon, s.label, s.blurb, () => setSpeed(s.id)),
                    )}
                </div>

                <div className="flex items-center gap-2 text-white font-orbitron text-sm mt-5 mb-1">
                    <span className="material-symbols-outlined text-lg">pace</span>
                    Table Pace
                </div>
                <p className="text-white/50 text-[11px] mb-3 leading-relaxed">
                    Manual keeps each finished trick on the felt until you tap advance (or play your
                    next card) — nobody else&apos;s table waits on you.
                </p>
                <div className="space-y-1.5">
                    {PACES.map((p) =>
                        option(pace === p.id, p.icon, p.label, p.blurb, () => setPace(p.id)),
                    )}
                </div>

                <button
                    onClick={onClose}
                    className="mt-4 w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-orbitron text-sm"
                >
                    Done
                </button>
            </div>
        </div>
    );
}
