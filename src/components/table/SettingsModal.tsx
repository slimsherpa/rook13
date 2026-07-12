'use client';

// Table settings, opened from the gear in the game header. Currently one
// setting: game speed. It's device-local — everyone at the table picks the
// pace of their own screen (bot pacing follows the host's device, since the
// host's client usually wins the race to move the bots).

import { GAME_SPEEDS, useGameSpeed } from '@/lib/settings';

export default function SettingsModal({ onClose }: { onClose: () => void }) {
    const [speed, setSpeed] = useGameSpeed();

    return (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-navy-950 border border-white/15 rounded-2xl p-5 w-full max-w-xs" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 text-white font-orbitron text-sm mb-1">
                    <span className="material-symbols-outlined text-lg">settings</span>
                    Game Speed
                </div>
                <p className="text-white/50 text-[11px] mb-3 leading-relaxed">
                    Animations and waits on this device — the bots think just as hard at every speed.
                </p>
                <div className="space-y-1.5">
                    {GAME_SPEEDS.map((s) => (
                        <button
                            key={s.id}
                            onClick={() => setSpeed(s.id)}
                            className={`w-full flex items-center gap-3 rounded-xl border p-2.5 text-left transition ${
                                speed === s.id
                                    ? 'border-sky-400 bg-sky-500/15'
                                    : 'border-white/10 bg-white/5 hover:border-white/30'
                            }`}
                        >
                            <span className={`material-symbols-outlined text-xl ${speed === s.id ? 'text-sky-300' : 'text-white/50'}`}>
                                {s.icon}
                            </span>
                            <span className="flex-1 min-w-0">
                                <span className={`block font-orbitron text-sm ${speed === s.id ? 'text-white font-bold' : 'text-white/85'}`}>
                                    {s.label}
                                </span>
                                <span className="block text-white/50 text-[11px]">{s.blurb}</span>
                            </span>
                            {speed === s.id && (
                                <span className="material-symbols-outlined text-sky-300 text-lg">check_circle</span>
                            )}
                        </button>
                    ))}
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
