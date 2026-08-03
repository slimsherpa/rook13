'use client';

// Table settings, opened from the gear in the game header. Device-local
// (everyone at the table picks the pace of their own screen; bot pacing
// follows the host's device, since the host's client usually wins the race
// to move the bots) — except the Turn Clock, the one whole-table rule here:
// it lives on the game doc and only the host can flip it.

import { GAME_SPEEDS, TablePace, useGameSpeed, useTablePace, useAiAssist, useBlunderDetector } from '@/lib/settings';
import { ASSIST_PINK } from './AssistDial';

const PACES: { id: TablePace; label: string; blurb: string; icon: string }[] = [
    { id: 'auto',   label: 'Auto',   blurb: 'Tricks sweep away on their own',                icon: 'play_circle' },
    { id: 'manual', label: 'Manual', blurb: 'Cards stay until you advance — count away',     icon: 'back_hand' },
];

interface SettingsModalProps {
    onClose: () => void;
    /** the whole-table turn clock — absent outside a live game */
    clock?: { on: boolean; isHost: boolean; onToggle: (on: boolean) => void };
}

export default function SettingsModal({ onClose, clock }: SettingsModalProps) {
    const [speed, setSpeed] = useGameSpeed();
    const [pace, setPace] = useTablePace();
    const [assist, setAssist] = useAiAssist();
    const [blunders, setBlunders] = useBlunderDetector();

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

                <div className="flex items-center gap-2 font-orbitron text-sm mt-5 mb-1" style={{ color: assist ? ASSIST_PINK : 'white' }}>
                    <span className="material-symbols-outlined text-lg">neurology</span>
                    AI Trainer
                </div>
                <p className="text-white/50 text-[11px] mb-3 leading-relaxed">
                    A coach over your shoulder: every choice shows a hot-pink dial for how likely the
                    latest AlphaRook brain would be to pick it. The rest of the table can see the
                    trainer is on — flip it any time.
                </p>
                <button
                    onClick={() => setAssist(!assist)}
                    className="w-full flex items-center gap-3 rounded-xl border p-2.5 text-left transition hover:border-white/30"
                    style={assist
                        ? { borderColor: ASSIST_PINK, backgroundColor: `${ASSIST_PINK}26` }
                        : { borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)' }}
                >
                    <span className="material-symbols-outlined text-xl" style={{ color: assist ? ASSIST_PINK : 'rgba(255,255,255,0.5)' }}>
                        {assist ? 'toggle_on' : 'toggle_off'}
                    </span>
                    <span className="flex-1 min-w-0">
                        <span className={`block font-orbitron text-sm ${assist ? 'text-white font-bold' : 'text-white/85'}`}>
                            {assist ? 'Trainer on' : 'Trainer off'}
                        </span>
                        <span className="block text-white/50 text-[11px]">
                            {assist ? 'Pick-likelihood dials are showing' : 'Play unassisted'}
                        </span>
                    </span>
                    {assist && <span className="material-symbols-outlined text-lg" style={{ color: ASSIST_PINK }}>check_circle</span>}
                </button>

                <div className="flex items-center gap-2 text-white font-orbitron text-sm mt-5 mb-1">
                    <span className="material-symbols-outlined text-lg">search_insights</span>
                    Blunder Detector
                </div>
                <p className="text-white/50 text-[11px] mb-3 leading-relaxed">
                    Adds an &quot;Ask AI to review this hand&quot; button to every hand recap. On
                    request, the solver replays the hand with all the cards face up and marks the
                    (at most two) plays that truly cost points — and what should have been played.
                    If a hand was doomed anyway, it stays quiet.
                </p>
                <div className="space-y-1.5">
                    {option(blunders, 'search_insights', blunders ? 'Detector on' : 'Detector off',
                        blunders ? 'The review button shows in recaps' : 'Recaps stay judgment-free',
                        () => setBlunders(!blunders))}
                </div>

                {clock && (
                    <>
                        <div className="flex items-center gap-2 text-white font-orbitron text-sm mt-5 mb-1">
                            <span className="material-symbols-outlined text-lg">timer</span>
                            Turn Clock
                            <span className="ml-auto px-1.5 py-px rounded bg-yellow-500/15 text-yellow-300/90 text-[9px] uppercase tracking-wide font-orbitron">
                                whole table
                            </span>
                        </div>
                        <p className="text-white/50 text-[11px] mb-3 leading-relaxed">
                            One rule for everyone at the table: when it&apos;s on, a player who sits on
                            their turn a full minute forfeits the game. Off by default — take all the
                            time you want.{clock.isHost ? '' : ' Only the host can flip this.'}
                        </p>
                        {clock.isHost ? (
                            <div className="space-y-1.5">
                                {option(clock.on, clock.on ? 'timer' : 'timer_off',
                                    clock.on ? 'Clock on' : 'Clock off',
                                    clock.on ? '60 seconds to play or forfeit' : 'No time pressure',
                                    () => clock.onToggle(!clock.on))}
                            </div>
                        ) : (
                            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-2.5">
                                <span className="material-symbols-outlined text-xl text-white/50">
                                    {clock.on ? 'timer' : 'timer_off'}
                                </span>
                                <span className="flex-1 min-w-0">
                                    <span className="block font-orbitron text-sm text-white/85">
                                        {clock.on ? 'Clock on' : 'Clock off'}
                                    </span>
                                    <span className="block text-white/50 text-[11px]">
                                        {clock.on ? '60 seconds to play or forfeit' : 'No time pressure'}
                                    </span>
                                </span>
                            </div>
                        )}
                    </>
                )}

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
