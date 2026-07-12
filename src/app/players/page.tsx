'use client';

// Everyone who plays Rook13, ranked by games played. Tap a player to open
// their trophy case; if you have a table waiting in its lobby, invite them
// to it from here — they get a tap-to-join card on their home screen and
// choose whether to come sit down.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { listPlayers, UserProfile } from '@/lib/firebase/userService';
import { listMyGames } from '@/lib/firebase/gameService';
import { sendInvite } from '@/lib/firebase/inviteService';
import { GameDoc } from '@/lib/game/types';
import LoadingPage from '@/components/LoadingPage';

export default function PlayersPage() {
    const { user, loading } = useAuth();
    const router = useRouter();
    const [players, setPlayers] = useState<UserProfile[] | null>(null);
    const [lobbyGame, setLobbyGame] = useState<GameDoc | null>(null);
    const [invited, setInvited] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!loading && !user) router.push('/');
    }, [user, loading, router]);

    useEffect(() => {
        if (!user) return;
        listPlayers().then(setPlayers).catch(() => setPlayers([]));
        // the most recent table of mine still in its lobby is the invite target
        listMyGames(user.uid)
            .then((games) => setLobbyGame(games.find((g) => g.status === 'lobby') ?? null))
            .catch(() => {});
    }, [user]);

    if (loading || !user || players === null) {
        return <LoadingPage title="Rook13" subtitle="Finding the players…" />;
    }

    const invite = async (p: UserProfile) => {
        if (!lobbyGame || invited.has(p.uid)) return;
        setInvited((prev) => new Set(prev).add(p.uid));
        try {
            await sendInvite(
                { id: lobbyGame.id, joinCode: lobbyGame.joinCode },
                { uid: user.uid, name: user.displayName || 'Player', ...(user.photoURL ? { photoURL: user.photoURL } : {}) },
                p.uid,
            );
        } catch {
            setInvited((prev) => {
                const next = new Set(prev);
                next.delete(p.uid);
                return next;
            });
        }
    };

    return (
        <div className="min-h-dvh bg-navy-900">
            <div className="max-w-md mx-auto px-4 py-5 pb-10">
                <div className="flex items-center justify-between mb-6">
                    <button onClick={() => router.push('/')} className="text-white/70 hover:text-white flex items-center gap-1 font-orbitron text-sm">
                        <span className="material-symbols-outlined">arrow_back</span> Lobby
                    </button>
                    <span className="font-orbitron font-bold text-white">ROOK<span className="text-yellow-400">13</span></span>
                </div>

                <h1 className="font-orbitron text-white text-lg font-bold mb-1">Players</h1>
                <p className="text-white/50 text-xs mb-4">
                    {lobbyGame
                        ? <>Invites go to your table <span className="font-code text-yellow-400">{lobbyGame.joinCode}</span> — they choose whether to join.</>
                        : 'Start a new game to invite players to your table.'}
                </p>

                <div className="space-y-2">
                    {players.map((p) => {
                        const isMe = p.uid === user.uid;
                        const s = p.stats;
                        return (
                            <div key={p.uid} className="rounded-xl bg-navy-950/50 border border-white/15 p-3 flex items-center gap-3">
                                <button
                                    onClick={() => router.push(isMe ? '/profile' : `/profile?uid=${p.uid}`)}
                                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                                >
                                    {p.photoURL ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={p.photoURL} alt="" className="w-10 h-10 rounded-full border border-white/20 flex-shrink-0" referrerPolicy="no-referrer" />
                                    ) : (
                                        <span className="w-10 h-10 rounded-full bg-navy-900 border border-white/20 flex items-center justify-center text-white font-orbitron flex-shrink-0">
                                            {(p.displayName || 'P').charAt(0)}
                                        </span>
                                    )}
                                    <span className="min-w-0">
                                        <span className="block text-white font-orbitron text-sm truncate">
                                            {p.displayName}{isMe ? ' (you)' : ''}
                                        </span>
                                        <span className="block text-white/50 text-[11px]">
                                            {s?.gamesPlayed ?? 0} games · {s?.gamesWon ?? 0} wins
                                            {(s?.gamesPlayed ?? 0) > 0 ? ` · ${Math.round(((s?.gamesWon ?? 0) / s!.gamesPlayed) * 100)}%` : ''}
                                        </span>
                                    </span>
                                </button>
                                {!isMe && lobbyGame && (
                                    <button
                                        onClick={() => invite(p)}
                                        disabled={invited.has(p.uid)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-orbitron whitespace-nowrap flex items-center gap-1 ${
                                            invited.has(p.uid)
                                                ? 'bg-green-600/25 text-green-300'
                                                : 'bg-sky-600 hover:bg-sky-500 text-white'
                                        }`}
                                    >
                                        <span className="material-symbols-outlined text-sm">
                                            {invited.has(p.uid) ? 'check' : 'send'}
                                        </span>
                                        {invited.has(p.uid) ? 'Invited' : 'Invite'}
                                    </button>
                                )}
                                <span className="material-symbols-outlined text-white/30">chevron_right</span>
                            </div>
                        );
                    })}
                    {players.length === 0 && (
                        <p className="text-center text-white/60 font-orbitron text-sm py-8">No players yet.</p>
                    )}
                </div>
            </div>
        </div>
    );
}
