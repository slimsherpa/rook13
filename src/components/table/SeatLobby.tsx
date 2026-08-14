'use client';

// Pre-game table: share the join code, pick seats/teams, fill with bots.
// Teams are fixed by seat: A1+A2 vs B1+B2.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GameDoc, Seat, SeatInfo, GameAction, BotStyle, BOT_STYLE_LABELS, PLAYABLE_BOT_STYLES, DEFAULT_BOT_STYLE, SECRET_BOT_STYLE, personaFor } from '@/lib/game/types';
import BotAvatar from './BotAvatar';

// AlphaGodRook stays off the picker until someone triple-taps the quiet
// line under START GAME. The unlock is per-device and survives reloads.
const GODROOK_KEY = 'rook13.godrook.unlocked';
const godrookUnlocked = () =>
    typeof window !== 'undefined' && window.localStorage.getItem(GODROOK_KEY) === '1';

interface SeatLobbyProps {
    game: GameDoc;
    myUid: string;
    myName: string;
    myPhotoURL?: string;
    isHost: boolean;
    act: (action: GameAction) => Promise<void>;
    actionError?: string | null;
}

const TEAM_SEATS: { team: 'A' | 'B'; seats: Seat[]; color: string; text: string }[] = [
    { team: 'A', seats: ['A1', 'A2'], color: 'border-sky-500/60', text: 'text-sky-300' },
    { team: 'B', seats: ['B1', 'B2'], color: 'border-orange-500/60', text: 'text-orange-300' },
];

export default function SeatLobby({ game, myUid, myName, myPhotoURL, isHost, act, actionError }: SeatLobbyProps) {
    const router = useRouter();
    const [copied, setCopied] = useState(false);
    const [godUnlocked, setGodUnlocked] = useState(godrookUnlocked);
    const [godFlash, setGodFlash] = useState(false);
    const godTaps = useRef<{ count: number; last: number }>({ count: 0, last: 0 });

    const secretTap = () => {
        const now = Date.now();
        godTaps.current = now - godTaps.current.last < 1200
            ? { count: godTaps.current.count + 1, last: now }
            : { count: 1, last: now };
        if (godTaps.current.count >= 3 && !godUnlocked) {
            window.localStorage.setItem(GODROOK_KEY, '1');
            setGodUnlocked(true);
            setGodFlash(true);
            setTimeout(() => setGodFlash(false), 4000);
        }
    };

    const mySeat = (Object.keys(game.seats) as Seat[]).find(
        (s) => game.seats[s].kind === 'human' && game.seats[s].uid === myUid,
    );

    // Copy/share the bare URL only — mixing prose into the clipboard mangles
    // the link when pasted into an address bar or chat that joins lines.
    const shareGame = async () => {
        const url = `${window.location.origin}/game?id=${game.id}`;
        if (navigator.share) {
            try {
                await navigator.share({ title: `Rook13 — table ${game.joinCode}`, url });
                return;
            } catch { /* user cancelled; fall through to clipboard */ }
        }
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const seatCard = (seat: Seat) => {
        const info: SeatInfo = game.seats[seat];
        const isMe = info.kind === 'human' && info.uid === myUid;

        return (
            <div key={seat} className={`
                rounded-xl border bg-navy-950/40 p-3 flex items-center gap-3
                ${isMe ? 'border-yellow-400/70' : 'border-white/15'}
            `}>
                <div className="w-10 h-10 rounded-full bg-navy-950 border border-white/15 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {info.kind === 'human' && info.photoURL ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={info.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : info.kind === 'bot' ? (
                        <BotAvatar style={info.botStyle} size={40} />
                    ) : (
                        <span className="material-symbols-outlined text-white/40">chair</span>
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-white font-orbitron text-sm truncate">
                        {info.kind === 'open' ? 'Open Seat' : info.name}{isMe ? ' (you)' : ''}
                    </div>
                    <div className="text-white/50 text-[11px] font-orbitron">
                        {seat}{info.kind === 'bot' ? ` · ${BOT_STYLE_LABELS[info.botStyle ?? 'basic']}` : ''}
                    </div>
                    {/* bot mode picker (host only) — the trained AlphaRook brains */}
                    {isHost && info.kind === 'bot' && (() => {
                        const current = info.botStyle ?? 'basic';
                        const roster = godUnlocked ? [SECRET_BOT_STYLE, ...PLAYABLE_BOT_STYLES] : PLAYABLE_BOT_STYLES;
                        const styles = roster.includes(current)
                            ? roster
                            : [...roster, current]; // legacy doc: keep its style selectable
                        return (
                            <select
                                value={current}
                                onChange={(e) => {
                                    const style = e.target.value as BotStyle;
                                    // swap the brain only — the bot keeps its
                                    // table name (the engine preserves it)
                                    act({ type: 'SET_BOT', seat, botStyle: style });
                                }}
                                className="mt-1.5 w-full rounded-md bg-navy-950 border border-white/15 text-white text-xs px-2 py-1.5 focus:outline-none focus:border-sky-400"
                            >
                                {styles.map((s) => {
                                    const p = personaFor(s);
                                    const rank = /^gen(\d+)$/.test(s) ? ` (AI·${s.slice(3)})` :
                                        s === 'teacher' ? ' (AI·21+t0)' :
                                        s === 'godrook' ? ' (∞)' : '';
                                    return <option key={s} value={s}>{p.emoji} {p.name}{rank}</option>;
                                })}
                            </select>
                        );
                    })()}
                </div>
                {/* actions stack vertically so the seat's info (and the bot
                    picker) keep the row's width */}
                <div className="flex flex-col gap-1.5 items-stretch flex-shrink-0">
                    {info.kind !== 'human' && !isMe && (
                        <button
                            onClick={() => act({ type: 'SIT', seat, player: { uid: myUid, name: myName, ...(myPhotoURL ? { photoURL: myPhotoURL } : {}) } })}
                            className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-orbitron whitespace-nowrap text-center"
                        >
                            Sit Here
                        </button>
                    )}
                    {isMe && (
                        <button
                            onClick={() => act({ type: 'LEAVE_SEAT', seat, uid: myUid })}
                            className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-xs font-orbitron text-center"
                        >
                            Stand
                        </button>
                    )}
                    {isHost && info.kind === 'open' && (
                        <button
                            onClick={() => act({ type: 'SET_BOT', seat, botStyle: DEFAULT_BOT_STYLE })}
                            className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-orbitron flex items-center justify-center gap-1 whitespace-nowrap"
                        >
                            <span className="material-symbols-outlined text-sm">smart_toy</span>
                            Add Bot
                        </button>
                    )}
                    {isHost && info.kind === 'bot' && (
                        <button
                            onClick={() => act({ type: 'OPEN_SEAT', seat })}
                            className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-xs font-orbitron whitespace-nowrap text-center"
                        >
                            Remove
                        </button>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-dvh bg-navy-900 flex flex-col items-center px-4 pt-6 pb-24">
            <div className="w-full max-w-md">
                <div className="flex items-center justify-between mb-6">
                    <button onClick={() => router.push('/')} className="text-white/70 hover:text-white flex items-center gap-1 font-orbitron text-sm">
                        <span className="material-symbols-outlined">arrow_back</span> Lobby
                    </button>
                    <span className="font-orbitron font-bold text-white">ROOK<span className="text-yellow-400">13</span></span>
                </div>

                {/* join code */}
                <div className="rounded-2xl bg-navy-950/60 border border-white/15 p-5 text-center mb-6">
                    <div className="text-white/60 text-xs font-orbitron uppercase tracking-widest">Table Code</div>
                    <div className="font-code text-5xl text-yellow-400 mt-1 ml-[0.28em]">
                        {game.joinCode}
                    </div>
                    <button
                        onClick={shareGame}
                        className="mt-3 px-5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-orbitron text-sm inline-flex items-center gap-2"
                    >
                        <span className="material-symbols-outlined text-base">ios_share</span>
                        {copied ? 'Copied!' : 'Invite Players'}
                    </button>
                </div>

                {/* teams */}
                <div className="space-y-4">
                    {TEAM_SEATS.map(({ team, seats, color, text }) => (
                        <div key={team} className={`rounded-2xl border ${color} bg-navy-950/30 p-3`}>
                            <div className={`font-orbitron text-xs font-bold mb-2 ${text}`}>TEAM {team}</div>
                            <div className="space-y-2">{seats.map(seatCard)}</div>
                        </div>
                    ))}
                </div>

                {!mySeat && (
                    <p className="text-center text-yellow-300/90 font-orbitron text-xs mt-4">
                        Tap “Sit” to take a seat — or stay and spectate once the game starts.
                    </p>
                )}

                {/* the one whole-table rule set before the deal: the turn
                    clock. Host flips it; everyone sees where it stands. */}
                <div className="mt-4 rounded-2xl border border-white/15 bg-navy-950/40 p-3 flex items-center gap-3">
                    <span className={`material-symbols-outlined text-2xl ${game.clockEnabled ? 'text-yellow-300' : 'text-white/40'}`}>
                        {game.clockEnabled ? 'timer' : 'timer_off'}
                    </span>
                    <div className="flex-1 min-w-0">
                        <div className="text-white font-orbitron text-sm">
                            Turn Clock {game.clockEnabled ? 'on' : 'off'}
                        </div>
                        <div className="text-white/50 text-[11px] leading-snug">
                            {game.clockEnabled
                                ? '60 seconds to play or forfeit — for the whole table'
                                : 'Everyone takes as long as they want'}
                            {!isHost && ' · host sets this'}
                        </div>
                    </div>
                    {isHost && (
                        <button
                            onClick={() => act({ type: 'SET_CLOCK', uid: myUid, on: !game.clockEnabled })}
                            className={`px-3 py-1.5 rounded-lg text-xs font-orbitron whitespace-nowrap ${
                                game.clockEnabled
                                    ? 'bg-yellow-500 hover:bg-yellow-400 text-navy-950 font-bold'
                                    : 'bg-gray-700 hover:bg-gray-600 text-white'
                            }`}
                        >
                            {game.clockEnabled ? 'Turn off' : 'Turn on'}
                        </button>
                    )}
                </div>

                {/* DayDream: the table's Gen26 bots imagine the hidden hands
                    before committing. Host flips it; also lives in the
                    in-game settings, flippable mid-hand. Only shown when a
                    Gen26 (Cosmo) bot is actually seated. */}
                {Object.values(game.seats).some((s) => s.kind === 'bot' && s.botStyle === 'gen26') && (
                    <div className="mt-3 rounded-2xl border border-white/15 bg-navy-950/40 p-3 flex items-center gap-3">
                        <span className={`material-symbols-outlined text-2xl ${game.botThink ? 'text-sky-300' : 'text-white/40'}`}>
                            {game.botThink ? 'psychology' : 'bolt'}
                        </span>
                        <div className="flex-1 min-w-0">
                            <div className="text-white font-orbitron text-sm">
                                Bot Thinking {game.botThink ? 'on' : 'off'}
                            </div>
                            <div className="text-white/50 text-[11px] leading-snug">
                                {game.botThink
                                    ? 'Bots think longer but are a little smarter — games run a bit slower'
                                    : 'Bots play on instinct — instant moves'}
                                {!isHost && ' · host sets this'}
                            </div>
                        </div>
                        {isHost && (
                            <button
                                onClick={() => act({ type: 'SET_BOT_THINK', uid: myUid, on: !game.botThink })}
                                className={`px-3 py-1.5 rounded-lg text-xs font-orbitron whitespace-nowrap ${
                                    game.botThink
                                        ? 'bg-sky-500 hover:bg-sky-400 text-navy-950 font-bold'
                                        : 'bg-gray-700 hover:bg-gray-600 text-white'
                                }`}
                            >
                                {game.botThink ? 'Turn off' : 'Turn on'}
                            </button>
                        )}
                    </div>
                )}

                {/* errors (e.g. Firestore rules not deployed) */}
                {actionError && (
                    <div className="mt-4 rounded-xl bg-red-900/50 border border-red-500/50 p-3 text-red-200 text-xs font-orbitron text-center leading-relaxed">
                        {actionError}
                    </div>
                )}

                {/* start */}
                <div className="mt-6">
                    {isHost ? (
                        <>
                            <button
                                onClick={() => act({ type: 'START_GAME' })}
                                className="w-full py-4 rounded-2xl bg-sky-600 hover:bg-sky-500 text-white font-orbitron font-bold text-lg shadow-lg active:scale-[0.98] transition"
                            >
                                START GAME
                            </button>
                            <p className="text-center text-white/50 text-[11px] font-orbitron mt-2">
                                Empty seats are filled with bots automatically.
                            </p>
                            {/* the secret doorstep lives well below the button —
                                nobody summons the humbling machine by accident */}
                            <p
                                onClick={secretTap}
                                className="text-center text-white/20 text-[10px] font-orbitron mt-16 select-none cursor-default"
                            >
                                ROOK13
                            </p>
                            {godFlash && (
                                <p className="text-center text-yellow-300 text-xs font-orbitron mt-2 animate-pulse">
                                    👁️ AlphaGodRook has entered the camp.
                                </p>
                            )}
                        </>
                    ) : (
                        <p className="text-center text-white/70 font-orbitron text-sm animate-pulse">
                            Waiting for {game.seats.A1.kind === 'human' && game.seats.A1.uid === game.hostUid
                                ? game.seats.A1.name.split(' ')[0]
                                : 'the host'} to start the game…
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
