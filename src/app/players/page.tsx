'use client';

// The family leaderboard — everyone who plays Rook13, ranked by ladder
// rating and grouped into tiers, Bronze up to GrandMaster. The rating is
// the margin-aware Elo from lib/game/skill.ts, replayed from each player's
// game history (cached per device — see skillService). Tap a player to
// open their trophy case; if you have a table waiting in its lobby, invite
// them to it from here — they get a tap-to-join card on their home screen
// and choose whether to come sit down.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { listPlayers, UserProfile } from '@/lib/firebase/userService';
import { listMyGames } from '@/lib/firebase/gameService';
import { sendInvite } from '@/lib/firebase/inviteService';
import { PLACEMENT_GAMES, skillForAll } from '@/lib/firebase/skillService';
import { SkillResult } from '@/lib/game/skill';
import { GameDoc } from '@/lib/game/types';
import { GRANDMASTER, MASTER, RANK_TIERS, RankInfo, gmSeatCount, rankFor } from '@/lib/game/rank';
import { listAllProgress } from '@/lib/minigames/service';
import RankBadge from '@/components/ui/RankBadge';
import LoadingPage from '@/components/LoadingPage';

interface Row {
    p: UserProfile;
    skill: SkillResult;
    rank: RankInfo;
    /** 1-based place on the ladder, or null for rookies still placing */
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
    const [skills, setSkills] = useState<Record<string, SkillResult> | null>(null);
    /** best Beat the Bot layer per uid (RANK_TIERS index), null = never played */
    const [drillLayers, setDrillLayers] = useState<Record<string, number | null>>({});
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

    // ratings replay (cached per device), then each player's drill layers
    useEffect(() => {
        if (!players) return;
        let live = true;
        skillForAll(players).then((s) => { if (live) setSkills(s); });
        Promise.all(players.map(async (p) => {
            try {
                const all = await listAllProgress(p.uid);
                const played = all.filter((mg) => mg.attempts > 0);
                return [p.uid, played.length
                    ? Math.max(...played.map((mg) => mg.layer ?? 0))
                    : null] as const;
            } catch {
                return [p.uid, null] as const;
            }
        })).then((pairs) => {
            if (live) setDrillLayers(Object.fromEntries(pairs));
        });
        return () => { live = false; };
    }, [players]);

    if (loading || !user || players === null || skills === null) {
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

    const skillOf = (p: UserProfile): SkillResult =>
        skills[p.uid] ?? { rating: 1000, ranked: 0, provisional: true };

    // rating desc, win % breaking ties, so equal grinders sort by quality
    const ranked: Row[] = players
        .filter((p) => !skillOf(p).provisional)
        .map((p) => {
            const skill = skillOf(p);
            return { p, skill, rank: rankFor(skill.rating, p.stats), place: null as number | null };
        })
        .sort((a, b) =>
            b.skill.rating - a.skill.rating
            || (b.rank.winPct ?? 0) - (a.rank.winPct ?? 0)
            || (b.p.stats?.gamesWon ?? 0) - (a.p.stats?.gamesWon ?? 0))
        .map((r, i) => ({ ...r, place: i + 1 }));

    // only so many lightning bolts: GM seats scale with the ranked field,
    // overflow qualifiers show as Master (SC2 GM-ladder style)
    const seats = gmSeatCount(ranked.length);
    let bolts = 0;
    for (const r of ranked) {
        if (r.rank.tier.key !== 'grandmaster') continue;
        bolts++;
        if (bolts > seats) {
            r.rank = { ...r.rank, tier: MASTER, next: GRANDMASTER, progress: 1 };
        }
    }

    const rookies: Row[] = players
        .filter((p) => skillOf(p).provisional)
        .map((p) => {
            const skill = skillOf(p);
            return { p, skill, rank: rankFor(skill.rating, p.stats), place: null };
        })
        .sort((a, b) => b.skill.ranked - a.skill.ranked);

    // tier sections, strongest first, only the ones somebody has reached
    const sections = [...RANK_TIERS].reverse()
        .map((tier) => ({ tier, rows: ranked.filter((r) => r.rank.tier.key === tier.key) }))
        .filter((s) => s.rows.length > 0);

    const playerRow = ({ p, skill, rank, place }: Row) => {
        const isMe = p.uid === user.uid;
        const s = p.stats;
        const drill = drillLayers[p.uid];
        const drillTier = drill !== null && drill !== undefined ? RANK_TIERS[drill] : null;
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
                            {' '}· <span className="font-orbitron text-white/70">{skill.rating} SR</span>
                            {skill.provisional
                                ? ` · placements ${skill.ranked}/${PLACEMENT_GAMES}`
                                : ` · ${s?.gamesPlayed ?? 0} games${rank.winPct !== null ? ` · ${rank.winPct}%` : ''}`}
                        </span>
                        {drillTier && (
                            <span className={`inline-flex items-center gap-1 mt-1 px-1.5 py-px rounded-full border border-fuchsia-400/30 bg-fuchsia-500/10 font-orbitron text-[9px] font-bold ${drillTier.color}`}>
                                <span className="material-symbols-outlined text-[10px] text-fuchsia-400">sports_esports</span>
                                {drillTier.emoji} {drillTier.name}
                            </span>
                        )}
                        {/* the climb to the next tier */}
                        {!skill.provisional && rank.next && (
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
                    Skill Rating, StarCraft-style: beat stronger bots to climb, and the
                    scoreboard margin counts — close losses to Cosmo barely sting, blowout
                    wins pay extra. Trainer &amp; counter games earn reduced SR.
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
                            {tier.key === 'grandmaster' && (
                                <span className="text-red-300/60 text-[10px] font-orbitron">
                                    {seats} seat{seats === 1 ? '' : 's'}
                                </span>
                            )}
                            <span className="flex-1 h-px bg-white/10" />
                            <span className="text-white/30 text-[10px] font-orbitron">{tier.min}+ SR</span>
                        </div>
                        <div className="space-y-2">{rows.map(playerRow)}</div>
                    </div>
                ))}

                {rookies.length > 0 && (
                    <div className="mb-4">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="font-orbitron font-bold text-sm text-white/40">🐣 Rookies</span>
                            <span className="flex-1 h-px bg-white/10" />
                            <span className="text-white/30 text-[10px] font-orbitron">
                                {PLACEMENT_GAMES} placement games to get ranked
                            </span>
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
