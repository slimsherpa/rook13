'use client';

// THE LOBBY — who's online right now, their ladder rank, and one big family
// group chat. Modeled on the competitive-lobby classics: presence row up
// top, chat below, everything one tap from a game (the NEW GAME button sits
// directly above this panel, and empty seats auto-fill with bots at start).

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PresenceDoc, subscribePresence } from '@/lib/firebase/presenceService';
import { ChatMessage, LOBBY_MSG_MAX, sendLobbyMessage, subscribeLobbyChat } from '@/lib/firebase/chatService';
import { listPlayers, UserProfile } from '@/lib/firebase/userService';
import { createGame, listMyGames } from '@/lib/firebase/gameService';
import { sendInvite } from '@/lib/firebase/inviteService';
import { rankFor, RankInfo } from '@/lib/game/rank';
import { skillForAll } from '@/lib/firebase/skillService';
import RankBadge from '@/components/ui/RankBadge';

interface LobbyPanelProps {
    myUid: string;
    myName: string;
    myPhotoURL?: string;
}

const timeShort = (ms: number): string => {
    const d = new Date(ms);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function LobbyPanel({ myUid, myName, myPhotoURL }: LobbyPanelProps) {
    const router = useRouter();
    const [online, setOnline] = useState<PresenceDoc[]>([]);
    const [msgs, setMsgs] = useState<ChatMessage[]>([]);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [ranks, setRanks] = useState<Record<string, RankInfo>>({});
    const [challenged, setChallenged] = useState<Set<string>>(new Set());
    const [challenging, setChallenging] = useState(false);
    const logRef = useRef<HTMLDivElement>(null);

    // "Want to play?" — one tap sets a table, invites them, and seats you.
    // They get the tap-to-join invite card (and a shout in the chat).
    const challenge = async (p: PresenceDoc) => {
        if (challenging || challenged.has(p.uid)) return;
        setChallenging(true);
        try {
            const me = { uid: myUid, name: myName, ...(myPhotoURL ? { photoURL: myPhotoURL } : {}) };
            const mine = await listMyGames(myUid).catch(() => []);
            const lobbyGame = mine.find((g) => g.status === 'lobby' && g.hostUid === myUid);
            const game = lobbyGame ?? await createGame(me);
            await sendInvite(game, me, p.uid);
            sendLobbyMessage(me, `🎴 challenged ${p.name.split(' ')[0]} — table ${game.joinCode}`).catch(() => {});
            setChallenged((s) => new Set(s).add(p.uid));
            router.push(`/game?id=${game.id}`);
        } catch (e) {
            console.error('challenge failed', e);
        } finally {
            setChallenging(false);
        }
    };

    useEffect(() => subscribePresence(setOnline), []);
    useEffect(() => subscribeLobbyChat(setMsgs), []);

    // ladder ranks for everyone we might render (players list is small —
    // family; skillForAll replays from history with a per-device cache)
    useEffect(() => {
        listPlayers().then(async (players: UserProfile[]) => {
            const skills = await skillForAll(players);
            const r: Record<string, RankInfo> = {};
            for (const p of players) {
                const sk = skills[p.uid];
                if (sk && !sk.provisional) r[p.uid] = rankFor(sk.rating, p.stats);
            }
            setRanks(r);
        }).catch(() => {});
    }, [online.length]);

    // keep the newest message in view
    useEffect(() => {
        logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    }, [msgs.length]);

    const send = async () => {
        const text = draft.trim();
        if (!text || sending) return;
        setSending(true);
        try {
            await sendLobbyMessage({ uid: myUid, name: myName }, text);
            setDraft('');
        } finally {
            setSending(false);
        }
    };

    return (
        <section className="mt-8 rounded-2xl border border-emerald-500/30 bg-navy-950/40 overflow-hidden">
            {/* header */}
            <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                <h2 className="text-white/80 font-orbitron text-xs uppercase tracking-widest flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    The Lobby
                </h2>
                <span className="text-emerald-300/80 font-orbitron text-[11px]">
                    {online.length} online
                </span>
            </div>

            {/* who's here — tap a player for their Trophy Case */}
            <div className="px-3 pb-2 flex gap-2 overflow-x-auto [-webkit-overflow-scrolling:touch]">
                {online.length === 0 && (
                    <span className="text-white/40 text-xs font-orbitron px-1 py-2">
                        Nobody else is here yet — say something and see who shows up.
                    </span>
                )}
                {online.map((p) => {
                    const rank = ranks[p.uid];
                    const isMe = p.uid === myUid;
                    return (
                        <div
                            key={p.uid}
                            className="flex-shrink-0 rounded-xl border border-white/10 bg-navy-950/60 px-2.5 py-1.5 flex items-center gap-2"
                        >
                            <button onClick={() => router.push(`/profile?uid=${p.uid}`)} className="flex items-center gap-2">
                                {p.photoURL ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={p.photoURL} alt="" className="w-6 h-6 rounded-full border border-white/20" referrerPolicy="no-referrer" />
                                ) : (
                                    <span className="w-6 h-6 rounded-full bg-navy-900 border border-white/20 flex items-center justify-center text-white text-[10px] font-orbitron">
                                        {p.name.charAt(0)}
                                    </span>
                                )}
                                <span className="text-left">
                                    <span className="block text-white font-orbitron text-[11px] leading-tight">
                                        {p.name.split(' ')[0]}{isMe ? ' (you)' : ''}
                                    </span>
                                    {rank && (
                                        <span className="block text-[10px] leading-tight">
                                            <RankBadge rank={rank} />
                                            {rank.winPct !== null && (
                                                <span className="text-white/50 font-orbitron"> · {rank.winPct}%</span>
                                            )}
                                        </span>
                                    )}
                                </span>
                            </button>
                            {!isMe && (
                                <button
                                    onClick={() => challenge(p)}
                                    disabled={challenging || challenged.has(p.uid)}
                                    className={`ml-1 px-2 py-1 rounded-lg text-[10px] font-orbitron font-bold whitespace-nowrap ${
                                        challenged.has(p.uid)
                                            ? 'bg-green-600/25 text-green-300'
                                            : 'bg-yellow-400 hover:bg-yellow-300 text-navy-950'
                                    }`}
                                >
                                    {challenged.has(p.uid) ? 'INVITED ✓' : 'PLAY?'}
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* the group chat */}
            <div ref={logRef} className="max-h-56 overflow-y-auto px-4 py-2 space-y-1.5 border-t border-white/10">
                {msgs.length === 0 && (
                    <p className="text-white/30 text-xs text-center py-3 font-orbitron">
                        The table talk starts here.
                    </p>
                )}
                {msgs.map((m) => {
                    const rank = ranks[m.uid];
                    return (
                        <div key={m.id} className="text-[13px] leading-snug">
                            <span className={`font-orbitron text-[11px] font-bold ${m.uid === myUid ? 'text-yellow-300' : 'text-sky-300'}`}>
                                {rank ? `${rank.tier.emoji} ` : ''}{m.name.split(' ')[0]}
                            </span>
                            <span className="text-white/35 text-[10px]"> {timeShort(m.at)} </span>
                            <span className="text-white/85 break-words">{m.text}</span>
                        </div>
                    );
                })}
            </div>

            {/* composer */}
            <div className="flex gap-2 p-2 border-t border-white/10">
                <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value.slice(0, LOBBY_MSG_MAX))}
                    onKeyDown={(e) => e.key === 'Enter' && send()}
                    placeholder="Talk to the lobby…"
                    className="flex-1 min-w-0 rounded-lg bg-navy-900/80 border border-white/15 px-3 py-2 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-emerald-400"
                />
                <button
                    onClick={send}
                    disabled={!draft.trim() || sending}
                    className="px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-orbitron text-xs font-bold"
                >
                    SEND
                </button>
            </div>
        </section>
    );
}
