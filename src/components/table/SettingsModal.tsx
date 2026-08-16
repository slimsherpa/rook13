'use client';

// Table settings, opened from the gear in the game header. Grouped into three
// sections: Speed (everything about pacing — this device's animations, trick
// sweeps, and the whole-table bot thinking), AI Trainer (the coach), and
// Table Rules (the turn clock). Device-local throughout (everyone at the
// table picks the pace of their own screen; bot pacing follows the host's
// device, since the host's client usually wins the race to move the bots) —
// except Bot Thinking and the Turn Clock, the whole-table rules: they live
// on the game doc and only the host can flip them.

import { GAME_SPEEDS, TablePace, useGameSpeed, useTablePace, useAiAssist, useSuperTrainer, useCardCounter, useCardPaletteId } from '@/lib/settings';
import { ASSIST_PINK } from './AssistDial';
import { COUNTER_ORANGE } from './CardCounter';
import { PALETTES, customPalette, getCustomSuits, nearestColorName, setCustomSuits } from '@/lib/game/palettes';
import { SUITS, Suit } from '@/lib/game/types';

const PACES: { id: TablePace; label: string; blurb: string; icon: string }[] = [
    { id: 'auto',   label: 'Auto',   blurb: 'Tricks sweep away on their own',                icon: 'play_circle' },
    { id: 'manual', label: 'Manual', blurb: 'Cards stay until you advance — count away',     icon: 'back_hand' },
];

interface SettingsModalProps {
    onClose: () => void;
    /** the whole-table turn clock — absent outside a live game */
    clock?: { on: boolean; isHost: boolean; onToggle: (on: boolean) => void };
    /** whole-table DayDream bot thinking — absent when the table has no Gen26 bots */
    botThink?: { on: boolean; isHost: boolean; onToggle: (on: boolean) => void };
}

export default function SettingsModal({ onClose, clock, botThink }: SettingsModalProps) {
    const [speed, setSpeed] = useGameSpeed();
    const [pace, setPace] = useTablePace();
    const [assist, setAssist] = useAiAssist();
    const [superTrainer, setSuperTrainer] = useSuperTrainer();
    const [counter, setCounter] = useCardCounter();
    const [paletteId, setPaletteId] = useCardPaletteId();

    // trainer and counter are single-select — the setters clear each other,
    // so this derived mode is never ambiguous
    const helpMode: 'off' | 'trainer' | 'counter' = assist ? 'trainer' : counter ? 'counter' : 'off';
    const pickHelp = (mode: 'off' | 'trainer' | 'counter') => {
        if (mode === 'trainer') setAssist(true);
        else if (mode === 'counter') setCounter(true);
        else { setAssist(false); setCounter(false); }
    };

    // a colored single-select row (the trainer's pink / the counter's orange)
    const helpOption = (mode: 'off' | 'trainer' | 'counter', color: string | null, icon: string, label: string, blurb: string) => {
        const selected = helpMode === mode;
        return (
            <button
                key={mode}
                onClick={() => pickHelp(mode)}
                className={`w-full flex items-center gap-3 rounded-xl border p-2.5 text-left transition hover:border-white/30 ${
                    selected && !color ? 'border-sky-400 bg-sky-500/15' : ''
                }`}
                style={selected && color
                    ? { borderColor: color, backgroundColor: `${color}26` }
                    : selected ? undefined
                    : { borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)' }}
            >
                <span className={`material-symbols-outlined text-xl ${selected && !color ? 'text-sky-300' : ''}`}
                    style={{ color: selected ? (color ?? undefined) : 'rgba(255,255,255,0.5)' }}>
                    {icon}
                </span>
                <span className="flex-1 min-w-0">
                    <span className={`block font-orbitron text-sm ${selected ? 'text-white font-bold' : 'text-white/85'}`}>
                        {label}
                    </span>
                    <span className="block text-white/50 text-[11px]">{blurb}</span>
                </span>
                {selected && (
                    <span className={`material-symbols-outlined text-lg ${!color ? 'text-sky-300' : ''}`} style={{ color: color ?? undefined }}>
                        check_circle
                    </span>
                )}
            </button>
        );
    };

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

    const section = (label: string, first = false) => (
        <div className={`flex items-center gap-2 ${first ? '' : 'mt-6'} mb-3`}>
            <span className="text-white/40 text-[10px] font-orbitron uppercase tracking-[0.25em]">{label}</span>
            <span className="flex-1 h-px bg-white/10" />
        </div>
    );

    const wholeTableBadge = (
        <span className="ml-auto px-1.5 py-px rounded bg-yellow-500/15 text-yellow-300/90 text-[9px] uppercase tracking-wide font-orbitron">
            whole table
        </span>
    );

    return (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-navy-950 border border-white/15 rounded-2xl p-5 w-full max-w-xs max-h-[90dvh] overflow-y-auto custom-scrollbar" onClick={(e) => e.stopPropagation()}>

                {/* ---- everything about pace lives together ---- */}
                {section('Speed', true)}

                <div className="flex items-center gap-2 text-white font-orbitron text-sm mb-1">
                    <span className="material-symbols-outlined text-lg">speed</span>
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

                {botThink && (
                    <>
                        <div className="flex items-center gap-2 text-white font-orbitron text-sm mt-5 mb-1">
                            <span className="material-symbols-outlined text-lg">psychology</span>
                            Bot Thinking
                            {wholeTableBadge}
                        </div>
                        <p className="text-white/50 text-[11px] mb-3 leading-relaxed">
                            Bots think longer but are a little smarter — they imagine how the hidden
                            hands could lie before committing to a card. Games run a bit slower.
                            Flip it any time, even mid-hand.{botThink.isHost ? '' : ' Only the host can flip this.'}
                        </p>
                        {botThink.isHost ? (
                            <div className="space-y-1.5">
                                {option(botThink.on, botThink.on ? 'psychology' : 'bolt',
                                    botThink.on ? 'Thinking on' : 'Instant play',
                                    botThink.on ? 'Bots take their time on the hard ones' : 'Bots play on instinct',
                                    () => botThink.onToggle(!botThink.on))}
                            </div>
                        ) : (
                            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-2.5">
                                <span className="material-symbols-outlined text-xl text-white/50">
                                    {botThink.on ? 'psychology' : 'bolt'}
                                </span>
                                <span className="flex-1 min-w-0">
                                    <span className="block font-orbitron text-sm text-white/85">
                                        {botThink.on ? 'Thinking on' : 'Instant play'}
                                    </span>
                                    <span className="block text-white/50 text-[11px]">
                                        {botThink.on ? 'Bots take their time on the hard ones' : 'Bots play on instinct'}
                                    </span>
                                </span>
                            </div>
                        )}
                    </>
                )}

                {/* ---- the coach ---- */}
                {section('AI Trainer')}

                <div className="flex items-center gap-2 font-orbitron text-sm mb-1"
                    style={{ color: assist ? ASSIST_PINK : counter ? COUNTER_ORANGE : 'white' }}>
                    <span className="material-symbols-outlined text-lg">{counter && !assist ? 'grid_on' : 'neurology'}</span>
                    AI Trainer
                </div>
                <p className="text-white/50 text-[11px] mb-3 leading-relaxed">
                    Pick one kind of help (the table can see which). The trainer puts hot-pink dials
                    on every choice — how likely the latest AlphaRook brain would be to pick it. The
                    card counter keeps a tiny 40-card grid on the felt showing the cards you can&apos;t
                    account for — your own hand starts punched out, and every card played punches
                    out too. Flip it any time.
                </p>
                <div className="space-y-1.5">
                    {helpOption('off', null, 'visibility_off', 'No help', 'Play unassisted')}
                    {helpOption('trainer', ASSIST_PINK, 'neurology', 'AI Trainer', 'Pick-likelihood dials on every choice')}
                    {helpOption('counter', COUNTER_ORANGE, 'grid_on', 'Card Counter', 'A 40-card grid tracks the cards still out there')}
                </div>

                {/* super-trainer: only offered while the trainer itself is on */}
                {assist && (
                    <>
                        <p className="text-white/50 text-[11px] mt-3 mb-1.5 leading-relaxed">
                            <span className="text-white/70 font-bold">Trainer thinks longer:</span> on
                            your card plays, the dials start blurry — the instant instinct — while the
                            cloud imagines how the hidden hands could lie. When it finishes, they
                            sharpen into the searched answer. Tough spots can take a while; play any
                            time, you never have to wait.
                        </p>
                        <button
                            onClick={() => setSuperTrainer(!superTrainer)}
                            className="w-full flex items-center gap-3 rounded-xl border p-2.5 text-left transition hover:border-white/30"
                            style={superTrainer
                                ? { borderColor: ASSIST_PINK, backgroundColor: `${ASSIST_PINK}26` }
                                : { borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)' }}
                        >
                            <span className="material-symbols-outlined text-xl" style={{ color: superTrainer ? ASSIST_PINK : 'rgba(255,255,255,0.5)' }}>
                                {superTrainer ? 'psychology' : 'bolt'}
                            </span>
                            <span className="flex-1 min-w-0">
                                <span className={`block font-orbitron text-sm ${superTrainer ? 'text-white font-bold' : 'text-white/85'}`}>
                                    {superTrainer ? 'Thinking longer' : 'Instinct only'}
                                </span>
                                <span className="block text-white/50 text-[11px]">
                                    {superTrainer ? 'Dials sharpen when the cloud finishes' : 'Instant reflex dials'}
                                </span>
                            </span>
                            {superTrainer && <span className="material-symbols-outlined text-lg" style={{ color: ASSIST_PINK }}>check_circle</span>}
                        </button>
                    </>
                )}

                {/* ---- whole-table rules ---- */}
                {clock && (
                    <>
                        {section('Table Rules')}

                        <div className="flex items-center gap-2 text-white font-orbitron text-sm mb-1">
                            <span className="material-symbols-outlined text-lg">timer</span>
                            Turn Clock
                            {wholeTableBadge}
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

                {/* ---- purely cosmetic: this device's card colors ---- */}
                {section('Card Colors')}

                <div className="flex items-center gap-2 text-white font-orbitron text-sm mb-1">
                    <span className="material-symbols-outlined text-lg">palette</span>
                    Card Colors
                </div>
                <p className="text-white/50 text-[11px] mb-3 leading-relaxed">
                    Repaint the four suits on this device — cards, trump table, the works.
                    Purely cosmetic: the suits keep their names, the game never changes.
                </p>
                <div className="space-y-1.5">
                    {[...PALETTES, customPalette()].map((p) => {
                        const selected = paletteId === p.id;
                        return (
                            <button
                                key={p.id}
                                onClick={() => setPaletteId(p.id)}
                                className={`w-full flex items-center gap-3 rounded-xl border p-2.5 text-left transition ${
                                    selected
                                        ? 'border-sky-400 bg-sky-500/15'
                                        : 'border-white/10 bg-white/5 hover:border-white/30'
                                }`}
                            >
                                <span className="flex gap-1 flex-shrink-0">
                                    {SUITS.map((s) => (
                                        <span
                                            key={s}
                                            className="w-3.5 h-5 rounded-[3px] border border-white/25"
                                            style={{ background: p.suits[s] }}
                                        />
                                    ))}
                                </span>
                                <span className="flex-1 min-w-0">
                                    <span className={`block font-orbitron text-sm ${selected ? 'text-white font-bold' : 'text-white/85'}`}>
                                        {p.name}
                                    </span>
                                    <span className="block text-white/50 text-[11px]">{p.blurb}</span>
                                </span>
                                {selected && (
                                    <span className="material-symbols-outlined text-sky-300 text-lg">check_circle</span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* the builder: pick four hues, the SYSTEM names them —
                    "Chartreuse Trump" beats "#7fff00 Trump" */}
                <p className="text-white/50 text-[11px] mt-3 mb-1.5 leading-relaxed">
                    <span className="text-white/70 font-bold">Make My Colors yours:</span> tap
                    a swatch to pick any hue — the game names it for you, and that name is
                    what the trump buttons say.
                </p>
                <div className="flex justify-between gap-2 rounded-xl border border-white/10 bg-white/5 p-2.5">
                    {SUITS.map((s: Suit) => {
                        const suits = getCustomSuits();
                        return (
                            <label key={s} className="flex-1 flex flex-col items-center gap-1 cursor-pointer">
                                <input
                                    type="color"
                                    value={suits[s]}
                                    onChange={(e) => {
                                        setCustomSuits({ ...getCustomSuits(), [s]: e.target.value });
                                        setPaletteId('custom');
                                    }}
                                    className="w-full h-9 rounded-lg border border-white/25 bg-transparent cursor-pointer"
                                />
                                <span className="text-white/70 text-[10px] font-orbitron truncate max-w-full">
                                    {nearestColorName(suits[s])}
                                </span>
                            </label>
                        );
                    })}
                </div>

                <button
                    onClick={onClose}
                    className="mt-5 w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-orbitron text-sm"
                >
                    Done
                </button>
            </div>
        </div>
    );
}
