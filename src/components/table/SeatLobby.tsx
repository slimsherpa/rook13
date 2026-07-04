'use client';

// Pre-game table: share the join code, pick seats/teams, fill with bots.
// Teams are fixed by seat: A1+A2 vs B1+B2.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GameDoc, Seat, SeatInfo, GameAction } from '@/lib/game/types';

interface SeatLobbyProps {
    game: GameDoc;
    myUid: string;
    myName: string;
    myPhotoURL?: string;
    isHost: boolean;
    act: (action: GameAction) => Promise<void>;
}

const TEAM_SEATS: { team: 'A' | 'B'; seats: Seat[]; color: string; text: string }[] = [
    { team: 'A', seats: ['A1', 'A2'], color: 'border-sky-500/60', text: 'text-sky-300' },
    { team: 'B', seats: ['B1', 'B2'], color: 'border-orange-500/60', text: 'text-orange-300' },
];

export default function SeatLobby({ game, myUid, myName, myPhotoURL, isHost, act }: SeatLobbyProps) {
    const router = useRouter();
    const [copied, setCopied] = useState(false);

    const mySeat = (Object.keys(game.seats) as Seat[]).find(
        (s) => game.seats[s].kind === 'human' && game.seats[s].uid === myUid,
    );

    const shareGame = async () => {
        const url = `${window.location.origin}/game?id=${game.id}`;
        const text = `Join my Rook13 game! Code: ${game.joinCode}`;
        if (navigator.share) {
            try {
                await navigator.share({ title: 'Rook13', text, url });
                return;
            } catch { /* user cancelled; fall through to clipboard */ }
        }
        await navigator.clipboard.writeText(`${text}\n${url}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const seatCard = (seat: Seat) => {
        const info: SeatInfo = game.seats[seat];
        const isMe = info.kind === 'human' && info.uid === myUid;

        return (
            <div key={seat} className={`
                rounded-xl border bg-green-900/50 p-3 flex items-center gap-3
                ${isMe ? 'border-yellow-400/70' : 'border-green-700/50'}
            `}>
                <div className="w-10 h-10 rounded-full bg-green-950 border border-green-700 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {info.kind === 'human' && info.photoURL ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={info.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : info.kind === 'bot' ? (
                        <span className="material-symbols-outlined text-white/80">smart_toy</span>
                    ) : (
                        <span className="material-symbols-outlined text-white/40">chair</span>
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-white font-orbitron text-sm truncate">
                        {info.kind === 'open' ? 'Open Seat' : info.name}{isMe ? ' (you)' : ''}
                    </div>
                    <div className="text-green-100/50 text-[11px] font-orbitron">{seat}{info.kind === 'bot' ? ' · Bot' : ''}</div>
                </div>
                <div className="flex gap-1">
                    {info.kind !== 'human' && !isMe && (
                        <button
                            onClick={() => act({ type: 'SIT', seat, player: { uid: myUid, name: myName, ...(myPhotoURL ? { photoURL: myPhotoURL } : {}) } })}
                            className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-orbitron"
                        >
                            Sit
                        </button>
                    )}
                    {isMe && (
                        <button
                            onClick={() => act({ type: 'LEAVE_SEAT', seat, uid: myUid })}
                            className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-xs font-orbitron"
                        >
                            Stand
                        </button>
                    )}
                    {isHost && info.kind === 'open' && (
                        <button
                            onClick={() => act({ type: 'SET_BOT', seat, botStyle: 'basic' })}
                            title="Fill with a bot"
                            className="px-2 py-1.5 rounded-lg bg-green-700 hover:bg-green-600 text-white text-xs font-orbitron flex items-center"
                        >
                            <span className="material-symbols-outlined text-sm">smart_toy</span>+
                        </button>
                    )}
                    {isHost && info.kind === 'bot' && (
                        <button
                            onClick={() => act({ type: 'OPEN_SEAT', seat })}
                            title="Remove bot"
                            className="px-2 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-xs font-orbitron flex items-center"
                        >
                            <span className="material-symbols-outlined text-sm">close</span>
                        </button>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-dvh bg-green-800 flex flex-col items-center px-4 py-6">
            <div className="w-full max-w-md">
                <div className="flex items-center justify-between mb-6">
                    <button onClick={() => router.push('/')} className="text-white/70 hover:text-white flex items-center gap-1 font-orbitron text-sm">
                        <span className="material-symbols-outlined">arrow_back</span> Lobby
                    </button>
                    <span className="font-orbitron font-bold text-white">ROOK<span className="text-yellow-400">13</span></span>
                </div>

                {/* join code */}
                <div className="rounded-2xl bg-green-950/60 border border-green-700/50 p-5 text-center mb-6">
                    <div className="text-green-100/60 text-xs font-orbitron uppercase tracking-widest">Table Code</div>
                    <div className="font-orbitron text-5xl font-black text-yellow-400 tracking-[0.3em] mt-1 ml-[0.3em]">
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
                        <div key={team} className={`rounded-2xl border ${color} bg-green-900/30 p-3`}>
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

                {/* start */}
                <div className="mt-6">
                    {isHost ? (
                        <>
                            <button
                                onClick={() => act({ type: 'START_GAME' })}
                                className="w-full py-4 rounded-2xl bg-green-600 hover:bg-green-500 text-white font-orbitron font-bold text-lg shadow-lg active:scale-[0.98] transition"
                            >
                                START GAME
                            </button>
                            <p className="text-center text-green-100/50 text-[11px] font-orbitron mt-2">
                                Empty seats are filled with bots automatically.
                            </p>
                        </>
                    ) : (
                        <p className="text-center text-green-100/70 font-orbitron text-sm animate-pulse">
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
