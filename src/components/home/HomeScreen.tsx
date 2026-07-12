'use client';

// Signed-in home: start a table, join by code, jump back into your games.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { GameDoc, teamOf, Seat, SEATS } from '@/lib/game/types';
import { createGame, findGameByCode, listActiveGames, listMyGames, listOpenGames } from '@/lib/firebase/gameService';
import { subscribeMyInvites, clearInvite, InviteDoc } from '@/lib/firebase/inviteService';
import JayCupModal from './JayCupModal';
import RookBird from '@/components/ui/RookBird';

export default function HomeScreen() {
    const { user, signOut } = useAuth();
    const router = useRouter();
    const [creating, setCreating] = useState(false);
    const [joinCode, setJoinCode] = useState('');
    const [joinError, setJoinError] = useState<string | null>(null);
    const [joining, setJoining] = useState(false);
    const [myGames, setMyGames] = useState<GameDoc[]>([]);
    const [openGames, setOpenGames] = useState<GameDoc[]>([]);
    const [liveGames, setLiveGames] = useState<GameDoc[]>([]);
    const [menuOpen, setMenuOpen] = useState(false);
    const [jayCupOpen, setJayCupOpen] = useState(false);
    const [invites, setInvites] = useState<InviteDoc[]>([]);

    // live "come play" invites from other players
    useEffect(() => {
        if (!user) return;
        return subscribeMyInvites(user.uid, setInvites);
    }, [user]);

    useEffect(() => {
        if (!user) return;
        const refresh = () => {
            listMyGames(user.uid).then(setMyGames).catch(() => {});
            listOpenGames().then((games) => {
                setOpenGames(games.filter((g) => !g.playerUids.includes(user.uid)));
            }).catch(() => {});
            // tables mid-game that aren't yours — wander over and watch
            listActiveGames().then((games) => {
                setLiveGames(games.filter((g) => !g.playerUids.includes(user.uid)));
            }).catch(() => {});
        };
        refresh();
        // coming back from a game (or from another app) should always show
        // fresh games — an ongoing table must be one tap away
        const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', refresh);
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', refresh);
        };
    }, [user]);

    if (!user) return null;

    const handleCreate = async () => {
        if (creating) return;
        setCreating(true);
        try {
            const game = await createGame({
                uid: user.uid,
                name: user.displayName || 'Player',
                ...(user.photoURL ? { photoURL: user.photoURL } : {}),
            });
            router.push(`/game?id=${game.id}`);
        } catch (e) {
            console.error(e);
            setCreating(false);
        }
    };

    const handleJoin = async () => {
        if (joinCode.trim().length < 4 || joining) return;
        setJoining(true);
        setJoinError(null);
        try {
            const game = await findGameByCode(joinCode);
            if (!game) {
                setJoinError('No table found with that code');
            } else {
                router.push(`/game?id=${game.id}`);
            }
        } catch {
            setJoinError('Could not look up that code');
        } finally {
            setJoining(false);
        }
    };

    const gameRow = (g: GameDoc) => {
        const mySeat = SEATS.find((s) => g.seats[s].kind === 'human' && g.seats[s].uid === user.uid);
        const names = SEATS
            .map((s) => g.seats[s])
            .filter((si) => si.kind === 'human')
            .map((si) => si.name.split(' ')[0])
            .join(', ');
        const status =
            g.status === 'lobby' ? { label: 'Waiting', cls: 'bg-white/10 text-white/70' } :
            g.status === 'active' ? { label: 'In Progress', cls: 'bg-sky-500/20 text-sky-300' } :
            g.winner && mySeat && teamOf(mySeat) === g.winner
                ? { label: 'Won', cls: 'bg-yellow-500/20 text-yellow-300' }
                : { label: 'Finished', cls: 'bg-gray-500/20 text-gray-300' };

        return (
            <button
                key={g.id}
                // finished games open straight into the trick-by-trick review
                onClick={() => router.push(g.status === 'completed' ? `/review?id=${g.id}` : `/game?id=${g.id}`)}
                className="w-full rounded-xl bg-navy-950/50 border border-white/15 hover:border-sky-400 p-3 flex items-center gap-3 text-left transition"
            >
                <span className="material-symbols-outlined text-white/60">
                    {g.status === 'completed' ? 'history' : 'playing_cards'}
                </span>
                <div className="flex-1 min-w-0">
                    <div className="text-white font-orbitron text-sm truncate">{names || 'Bot game'}</div>
                    <div className="text-white/50 text-[11px]">
                        {g.status !== 'lobby' && `${g.scores.A} – ${g.scores.B} · `}
                        {new Date(g.updatedAt).toLocaleDateString()} · code <span className="font-code text-[10px]">{g.joinCode}</span>
                    </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-orbitron ${status.cls}`}>{status.label}</span>
            </button>
        );
    };

    return (
        <div className="min-h-dvh bg-navy-900">
            <div className="max-w-md mx-auto px-4 py-5">
                {/* header */}
                <div className="flex items-center justify-between mb-8">
                    <h1 className="font-orbitron text-3xl font-black text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.4)] flex items-center gap-2.5">
                        <RookBird className="w-11 h-11 text-white/90" />
                        ROOK<span className="text-yellow-400 -ml-2">13</span>
                    </h1>
                    <div className="relative">
                        <button onClick={() => setMenuOpen(!menuOpen)} className="flex items-center gap-2">
                            <span className="text-white/90 font-orbitron text-xs hidden sm:block">{user.displayName?.split(' ')[0]}</span>
                            {user.photoURL ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={user.photoURL} alt="" className="w-9 h-9 rounded-full border-2 border-white/30" referrerPolicy="no-referrer" />
                            ) : (
                                <span className="w-9 h-9 rounded-full bg-navy-950 border-2 border-white/30 flex items-center justify-center text-white font-orbitron">
                                    {(user.displayName || 'P').charAt(0)}
                                </span>
                            )}
                        </button>
                        {menuOpen && (
                            <>
                                <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
                                <div className="absolute right-0 mt-2 w-44 bg-navy-950 border border-white/15 rounded-xl shadow-xl z-30 overflow-hidden">
                                    <button
                                        onClick={() => router.push('/profile')}
                                        className="w-full px-4 py-3 text-left text-white font-orbitron text-sm hover:bg-white/10 flex items-center gap-2"
                                    >
                                        <span className="material-symbols-outlined text-base">trophy</span> Trophy Case
                                    </button>
                                    <button
                                        onClick={() => router.push('/players')}
                                        className="w-full px-4 py-3 text-left text-white font-orbitron text-sm hover:bg-white/10 flex items-center gap-2"
                                    >
                                        <span className="material-symbols-outlined text-base">groups</span> Players
                                    </button>
                                    <button
                                        onClick={signOut}
                                        className="w-full px-4 py-3 text-left text-white font-orbitron text-sm hover:bg-white/10 flex items-center gap-2"
                                    >
                                        <span className="material-symbols-outlined text-base">logout</span> Log Out
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* incoming table invites — accepting is always the player's call */}
                {invites.length > 0 && (
                    <div className="space-y-2 mb-4">
                        {invites.map((inv) => (
                            <div key={inv.id} className="rounded-xl border border-yellow-500/50 bg-yellow-500/10 p-3 flex items-center gap-3 animate-card-reveal">
                                {inv.fromPhotoURL ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={inv.fromPhotoURL} alt="" className="w-9 h-9 rounded-full border border-white/25 flex-shrink-0" referrerPolicy="no-referrer" />
                                ) : (
                                    <span className="w-9 h-9 rounded-full bg-navy-950 border border-white/25 flex items-center justify-center text-white font-orbitron text-sm flex-shrink-0">
                                        {inv.fromName.charAt(0)}
                                    </span>
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className="text-white font-orbitron text-xs truncate">
                                        {inv.fromName.split(' ')[0]} invited you to play!
                                    </div>
                                    <div className="text-white/50 text-[11px]">table <span className="font-code text-yellow-400">{inv.joinCode}</span></div>
                                </div>
                                <button
                                    onClick={() => { clearInvite(inv); router.push(`/game?id=${inv.gameId}`); }}
                                    className="px-3.5 py-2 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-navy-950 text-xs font-orbitron font-bold whitespace-nowrap"
                                >
                                    Join
                                </button>
                                <button
                                    onClick={() => clearInvite(inv)}
                                    className="text-white/50 hover:text-white flex items-center"
                                    title="Dismiss"
                                >
                                    <span className="material-symbols-outlined text-lg">close</span>
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* primary actions */}
                <button
                    onClick={handleCreate}
                    disabled={creating}
                    className="w-full py-5 rounded-2xl bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white font-orbitron font-bold text-xl shadow-lg flex items-center justify-center gap-3 active:scale-[0.98] transition"
                >
                    <span className="material-symbols-outlined text-2xl">playing_cards</span>
                    {creating ? 'Setting the table…' : 'NEW GAME'}
                </button>

                <div className="flex gap-2 mt-3">
                    <input
                        value={joinCode}
                        onChange={(e) => { setJoinCode(e.target.value.toUpperCase()); setJoinError(null); }}
                        onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                        placeholder="TABLE CODE"
                        maxLength={4}
                        className="flex-1 rounded-xl bg-navy-950/60 border border-white/15 px-4 py-3 text-white font-code text-center placeholder:text-white/30 placeholder:tracking-normal placeholder:font-normal focus:outline-none focus:border-sky-400"
                    />
                    <button
                        onClick={handleJoin}
                        disabled={joinCode.trim().length < 4 || joining}
                        className="px-6 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white font-orbitron font-bold"
                    >
                        JOIN
                    </button>
                </div>
                {joinError && <p className="text-red-300 text-xs font-orbitron mt-2 text-center">{joinError}</p>}

                {/* my games */}
                {myGames.length > 0 && (
                    <section className="mt-8">
                        <h2 className="text-white/70 font-orbitron text-xs uppercase tracking-widest mb-2">My Games</h2>
                        <div className="space-y-2">{myGames.slice(0, 8).map(gameRow)}</div>
                    </section>
                )}

                {/* open tables */}
                {openGames.length > 0 && (
                    <section className="mt-6">
                        <h2 className="text-white/70 font-orbitron text-xs uppercase tracking-widest mb-2">Open Tables</h2>
                        <div className="space-y-2">{openGames.slice(0, 5).map(gameRow)}</div>
                    </section>
                )}

                {/* live tables — wander over and watch, like leaning on the
                    back of a chair at the family reunion */}
                {liveGames.length > 0 && (
                    <section className="mt-6">
                        <h2 className="text-white/70 font-orbitron text-xs uppercase tracking-widest mb-2 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                            Live Tables
                        </h2>
                        <div className="space-y-2">
                            {liveGames.slice(0, 5).map((g) => {
                                const names = SEATS
                                    .map((s) => g.seats[s])
                                    .filter((si) => si.kind === 'human')
                                    .map((si) => si.name.split(' ')[0])
                                    .join(', ');
                                return (
                                    <button
                                        key={g.id}
                                        onClick={() => router.push(`/game?id=${g.id}`)}
                                        className="w-full rounded-xl bg-navy-950/50 border border-white/15 hover:border-red-400/70 p-3 flex items-center gap-3 text-left transition"
                                    >
                                        <span className="material-symbols-outlined text-red-400/90">visibility</span>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-white font-orbitron text-sm truncate">{names || 'Bot battle'}</div>
                                            <div className="text-white/50 text-[11px]">
                                                <span className="text-sky-300 font-bold">{g.scores.A}</span>
                                                {' – '}
                                                <span className="text-orange-300 font-bold">{g.scores.B}</span>
                                                {' · hand '}{g.handNumber}
                                                {g.trump ? ` · ${g.trump} trump` : ''}
                                            </div>
                                        </div>
                                        <span className="px-2.5 py-1 rounded-full text-[10px] font-orbitron bg-red-500/15 text-red-300 border border-red-400/40">
                                            WATCH
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* JAY CUP */}
                <button
                    onClick={() => setJayCupOpen(true)}
                    className="mt-8 w-full rounded-2xl border border-yellow-500/40 bg-gradient-to-r from-yellow-500/10 to-transparent p-4 flex items-center gap-4"
                >
                    <span className="material-symbols-outlined text-yellow-400 text-4xl">trophy</span>
                    <div className="text-left">
                        <div className="font-orbitron text-white font-bold">THE JAY CUP</div>
                        <div className="text-white/60 text-xs">Hall of Champions · 2008–2026</div>
                    </div>
                </button>
            </div>

            {jayCupOpen && <JayCupModal onClose={() => setJayCupOpen(false)} />}
        </div>
    );
}
