'use client';

// The family leaderboard — everyone who plays Rook13, ranked by ladder
// rating and grouped into tiers, Bronze up to GrandMaster. Tap a player to
// open their trophy case; if you have a table waiting in its lobby, invite
// them to it from here — they get a tap-to-join card on their home screen
// and choose whether to come sit down.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { listPlayers, UserProfile } from '@/lib/firebase/userService';
import { listMyGames } from '@/lib/firebase/gameService';
import { sendInvite } from '@/lib/firebase/inviteService';
import { GameDoc } from '@/lib/game/types';
import { rankFor, RankInfo, RANK_TIERS } from '@/lib/game/rank';
import RankBadge from '@/components/ui/RankBadge';
import LoadingPage from '@/components/LoadingPage';

interface Row {
    p: UserProfile;
    rank: RankInfo;
    /** 1-based place on the ladder, or null for rookies with no games yet */
    place: number | null;
}

// medal colors for the overall top three
const PLACE_COLOR: Record<number, string> = {
    1: 'text-yellow-400',
    2: 'text-gray-300',
    3: 'text-amber-600',
};

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
        return <LoadingPage title="Rook13" subtitle="Ranking the family…" />;
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

    // rating desc, win % breaking ties, so equal grinders sort by quality
    const played: Row[] = players
        .filter((p) => (p.stats?.gamesPlayed ?? 0) > 0)
        .map((p) => ({ p, rank: rankFor(p.stats!), place: null as number | null }))
        .sort((a, b) =>
            b.rank.rating - a.rank.rating
            || (b.rank.winPct ?? 0) - (a.rank.winPct ?? 0)
            || (b.p.stats?.gamesWon ?? 0) - (a.p.stats?.gamesWon ?? 0))
        .map((r, i) => ({ ...r, place: i + 1 }));
    const rookies: Row[] = players
        .filter((p) => (p.stats?.gamesPlayed ?? 0) === 0)
        .map((p) => ({ p, rank: rankFor(p.stats ?? { gamesPlayed: 0, gamesWon: 0 }), place: null }));

    // tier sections, strongest first, only the ones somebody has reached
    const sections = [...RANK_TIERS].reverse()
        .map((tier) => ({ tier, rows: played.filter((r) => r.rank.tier.key === tier.key) }))
        .filter((s) => s.rows.length > 0);

    const playerRow = ({ p, rank, place }: Row) => {
        const isMe = p.uid === user.uid;
        const s = p.stats;
        return (
            <div
                key={p.uid}
                className={`rounded-xl bg-navy-950/50 border p-3 flex items-center gap-2.5 ${
                    isMe ? 'border-yellow-400/40' : 'border-white/15'
                }`}
            >
                <span className={`w-7 flex-shrink-0 text-center font-orbitron font-bold text-sm ${
                    place ? PLACE_COLOR[place] ?? 'text-white/40' : 'text-white/25'
                }`}>
                    {place ? `#${place}` : '—'}
                </span>
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
                    <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-white font-orbitron text-sm">
                            <span className="truncate">{p.displayName}{isMe ? ' (you)' : ''}</span>
                            {p.jayCupYears && p.jayCupYears.length > 0 && (
                                <span
                                    className="material-symbols-outlined text-sm text-yellow-400 flex-shrink-0"
                                    title={`Jay Cup Champion ${p.jayCupYears.join(', ')}`}
                                >
                                    trophy
                                </span>
                            )}
                        </span>
                        <span className="block text-white/50 text-[11px]">
                            <RankBadge rank={rank} />
                            {' '}· {s?.gamesPlayed ?? 0} games · {s?.gamesWon ?? 0} wins
                            {rank.winPct !== null ? ` · ${rank.winPct}%` : ''}
                        </span>
                        {/* the climb to the next tier */}
                        {(s?.gamesPlayed ?? 0) > 0 && rank.next && (
                            <span className="block mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
                                <span
                                    className={`block h-full rounded-full ${rank.tier.bar}`}
                                    style={{ width: `${Math.max(4, rank.progress * 100)}%` }}
                                />
                            </span>
                        )}
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

                <h1 className="font-orbitron text-white text-lg font-bold mb-1">Leaderboard</h1>
                <p className="text-white/50 text-xs mb-1">
                    Rating = 3 pts a win + 1 pt a game. Bronze 🥉 to GrandMaster ⚡ — wins carry you, showing up counts.
                </p>
                <p className="text-white/50 text-xs mb-4">
                    {lobbyGame
                        ? <>Invites go to your table <span className="font-code text-yellow-400">{lobbyGame.joinCode}</span> — they choose whether to join.</>
                        : 'Tap a player to see their trophy case.'}
                </p>

                {sections.map(({ tier, rows }) => (
                    <div key={tier.key} className="mb-4">
                        <div className="flex items-center gap-2 mb-2">
                            <span className={`font-orbitron font-bold text-sm ${tier.color}`}>
                                {tier.emoji} {tier.name}
                            </span>
                            <span className="flex-1 h-px bg-white/10" />
                            <span className="text-white/30 text-[10px] font-orbitron">{tier.min}+ pts</span>
                        </div>
                        <div className="space-y-2">{rows.map(playerRow)}</div>
                    </div>
                ))}

                {rookies.length > 0 && (
                    <div className="mb-4">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="font-orbitron font-bold text-sm text-white/40">🐣 Rookies</span>
                            <span className="flex-1 h-px bg-white/10" />
                            <span className="text-white/30 text-[10px] font-orbitron">first game pending</span>
                        </div>
                        <div className="space-y-2">{rookies.map(playerRow)}</div>
                    </div>
                )}

                {players.length === 0 && (
                    <p className="text-center text-white/60 font-orbitron text-sm py-8">No players yet.</p>
                )}
            </div>
        </div>
    );
}
