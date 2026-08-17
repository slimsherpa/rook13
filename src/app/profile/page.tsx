'use client';

// The Trophy Case: lifetime stats at /profile (yours) or /profile?uid=…
// (anyone else's — it's a family game, everyone's case is on display).

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { getUserProfile, listRecentGames, GameHistoryEntry, UserProfile, UserStats } from '@/lib/firebase/userService';
import { RecordRef } from '@/lib/game/stats';
import { Seat, SEATS, Team, partnerOf, teamOf } from '@/lib/game/types';
import { ladderRank } from '@/lib/game/rank';
import { ClimbStats, SkillResult } from '@/lib/game/skill';
import { climbFor, skillFor } from '@/lib/firebase/skillService';
import { selectionPct } from '@/lib/minigames/scoring';
import { LAYER_TIERS, TOP_LAYER } from '@/lib/minigames/difficulty';
import { listAllProgress } from '@/lib/minigames/service';
import { MiniGameProgress } from '@/lib/minigames/types';
import RankBadge from '@/components/ui/RankBadge';
import LoadingPage from '@/components/LoadingPage';
import ConfettiBurst from '@/components/ui/ConfettiBurst';

const pct = (num: number, den: number) => (den > 0 ? `${Math.round((num / den) * 100)}%` : '—');

/** A stat tile; give it `onOpen` and it becomes a "see it for yourself"
 *  link into the game review where the record was set. */
function StatTile({ icon, label, value, accent, sub, onOpen }: {
    icon: string;
    label: string;
    value: string | number;
    accent?: boolean;
    sub?: string;
    onOpen?: () => void;
}) {
    const inner = (
        <>
            <span className={`material-symbols-outlined text-xl ${accent ? 'text-yellow-400' : 'text-white/40'}`}>{icon}</span>
            <div className={`font-orbitron text-xl font-bold leading-tight ${accent ? 'text-yellow-400' : 'text-white'}`}>{value}</div>
            <div className="text-white/60 text-[10px] font-orbitron uppercase tracking-wide mt-0.5">{label}</div>
            {sub && <div className="text-white/40 text-[10px] mt-0.5">{sub}</div>}
        </>
    );
    if (!onOpen) {
        return <div className="rounded-xl bg-navy-950/50 border border-white/15 p-3 text-center">{inner}</div>;
    }
    return (
        <button
            onClick={onOpen}
            title="Watch the game where this happened"
            className="relative rounded-xl bg-navy-950/50 border border-white/15 p-3 text-center hover:border-sky-400/70 transition cursor-pointer w-full"
        >
            <span className="absolute top-1.5 right-1.5 material-symbols-outlined text-[13px] text-sky-300/80">
                play_circle
            </span>
            {inner}
        </button>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="mt-6">
            <h2 className="text-white/70 font-orbitron text-xs uppercase tracking-widest mb-2">{title}</h2>
            {children}
        </section>
    );
}

/** "Recent Games" — the player's latest finished games, newest first, each
 *  one a doorway into the full replay. */
function RecentGames({ uid }: { uid: string }) {
    const router = useRouter();
    const [count, setCount] = useState(5);
    const [games, setGames] = useState<GameHistoryEntry[] | null>(null);
    const [exhausted, setExhausted] = useState(false);

    useEffect(() => {
        let cancelled = false;
        listRecentGames(uid, count)
            .then((g) => {
                if (cancelled) return;
                setGames(g);
                if (g.length < count) setExhausted(true);
            })
            .catch(() => { if (!cancelled) setGames([]); });
        return () => { cancelled = true; };
    }, [uid, count]);

    if (!games || games.length === 0) return null;

    const when = (ms?: number) => {
        if (!ms) return '';
        const d = new Date(ms);
        const sameYear = d.getFullYear() === new Date().getFullYear();
        return d.toLocaleDateString(undefined, sameYear
            ? { month: 'short', day: 'numeric' }
            : { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const row = (g: GameHistoryEntry) => {
        const seat: Seat = g.seat;
        const myTeam: Team = g.team ?? teamOf(seat);
        const other: Team = myTeam === 'A' ? 'B' : 'A';
        const partner = g.seats?.[partnerOf(seat)]?.name.split(' ')[0];
        const opps = SEATS
            .filter((x) => teamOf(x) !== myTeam)
            .map((x) => g.seats?.[x]?.name.split(' ')[0])
            .filter(Boolean)
            .join(' & ');
        return (
            <button
                key={g.gameId}
                onClick={() => router.push(`/review?id=${g.gameId}`)}
                className="w-full rounded-xl bg-navy-950/50 border border-white/15 hover:border-sky-400/70 p-3 flex items-center gap-3 text-left transition"
            >
                <span className={`px-2 py-0.5 rounded-md font-orbitron text-[11px] font-bold flex-shrink-0 ${
                    g.won ? 'bg-yellow-500/20 text-yellow-300' : 'bg-white/10 text-white/50'
                }`}>
                    {g.won ? 'W' : 'L'}
                </span>
                <div className="flex-1 min-w-0">
                    <div className="font-orbitron text-sm">
                        <span className={g.won ? 'text-yellow-300 font-bold' : 'text-white'}>{g.scores?.[myTeam]}</span>
                        <span className="text-white/40"> – </span>
                        <span className="text-white/70">{g.scores?.[other]}</span>
                        <span className="text-white/40 text-[11px]"> · {g.hands} hand{g.hands === 1 ? '' : 's'}</span>
                    </div>
                    <div className="text-white/50 text-[11px] truncate">
                        {partner ? `with ${partner}` : ''}{opps ? ` vs ${opps}` : ''}{g.finishedAt ? ` · ${when(g.finishedAt)}` : ''}
                    </div>
                </div>
                <span className="material-symbols-outlined text-white/30 flex-shrink-0">play_circle</span>
            </button>
        );
    };

    return (
        <Section title="Recent Games">
            <div className="space-y-2">{games.map(row)}</div>
            {!exhausted && (
                <button
                    onClick={() => setCount((c) => c + 10)}
                    className="mt-2 w-full py-2 rounded-xl bg-white/5 border border-white/15 hover:border-white/30 text-white/70 font-orbitron text-xs"
                >
                    Show more
                </button>
            )}
        </Section>
    );
}

function TrophyCase({ s, openRef }: { s: UserStats; openRef: (r?: RecordRef) => void }) {
    const refs = s.recordRefs ?? {};
    const open = (key: string) => (refs[key] ? () => openRef(refs[key]) : undefined);
    const madeBids = Object.entries(s.madeByBid ?? {})
        .map(([bid, n]) => [Number(bid), n] as [number, number])
        .sort((a, b) => b[0] - a[0]);
    // the full ledger, 5 through 14 — chase the ones still dark
    const rainbowLedger = Array.from({ length: 10 }, (_, i) => {
        const num = i + 5;
        return [num, (s.rainbowCounts ?? {})[String(num)] ?? 0] as [number, number];
    });
    const anyRainbow = rainbowLedger.some(([, n]) => n > 0);

    return (
        <>
            <div className="grid grid-cols-3 gap-3">
                <StatTile icon="playing_cards" label="Games" value={s.gamesPlayed} />
                <StatTile icon="emoji_events" label="Wins" value={s.gamesWon} />
                <StatTile icon="percent" label="Win Rate" value={pct(s.gamesWon, s.gamesPlayed)} accent />
            </div>
            {((s.widestWinMargin ?? 0) > 0 || (s.fastestWin ?? 0) > 0) && (
                <div className={`mt-3 grid gap-3 ${
                    (s.widestWinMargin ?? 0) > 0 && (s.fastestWin ?? 0) > 0 ? 'grid-cols-2' : 'grid-cols-1'
                }`}>
                    {(s.widestWinMargin ?? 0) > 0 && (
                        <StatTile
                            icon="swords"
                            label="Widest Margin of Victory"
                            value={`${s.widestWinMargin} pts`}
                            accent
                            sub="your biggest blowout — final score gap in a win"
                            onOpen={open('widestWinMargin')}
                        />
                    )}
                    {(s.fastestWin ?? 0) > 0 && (
                        <StatTile
                            icon="bolt"
                            label="Fastest Win"
                            value={`${s.fastestWin} hand${s.fastestWin === 1 ? '' : 's'}`}
                            accent
                            sub="fewest hands to close out a game"
                            onOpen={open('fastestWin')}
                        />
                    )}
                </div>
            )}

            <Section title="At the Auction">
                <div className="grid grid-cols-3 gap-3">
                    <StatTile icon="gavel" label="Bids Won" value={s.bidsWon} />
                    <StatTile icon="task_alt" label="Made Its" value={s.bidsMade} />
                    <StatTile icon="percent" label="Bid Success" value={pct(s.bidsMade, s.bidsWon)} />
                </div>
                <div className="grid grid-cols-3 gap-3 mt-3">
                    <StatTile icon="trending_up" label="Highest Bid" value={s.highestBid || '—'} onOpen={open('highestBid')} />
                    <StatTile icon="workspace_premium" label="Best Bid Made" value={s.highestBidMade || '—'} accent onOpen={open('highestBidMade')} />
                    <StatTile icon="sentiment_very_dissatisfied" label="Times Set" value={s.timesSet} />
                </div>
                {madeBids.length > 0 && (
                    <div className="mt-3 rounded-xl bg-navy-950/50 border border-white/15 p-3.5">
                        <div className="text-white/60 text-[10px] font-orbitron uppercase tracking-wide mb-2">The Ledger</div>
                        <div className="space-y-1.5">
                            {madeBids.map(([bid, n]) => (
                                <div key={bid} className="flex items-center gap-3">
                                    <span className="w-9 text-right font-orbitron text-sm font-bold text-yellow-400">{bid}</span>
                                    <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                                        <div
                                            className="h-full bg-sky-500"
                                            style={{ width: `${Math.min(100, (n / Math.max(...madeBids.map(([, c]) => c))) * 100)}%` }}
                                        />
                                    </div>
                                    <span className="text-white/80 text-xs font-orbitron w-20">made it ×{n}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </Section>

            <Section title="On Defense">
                <div className="grid grid-cols-2 gap-3">
                    <StatTile icon="security" label="Sets Handed Out" value={s.setsDefended ?? 0} accent={(s.setsDefended ?? 0) > 0} sub="opponents bid it, you broke it" />
                    <StatTile icon="cleaning_services" label="9-Trick Sweeps" value={s.sweeps ?? 0} accent={(s.sweeps ?? 0) > 0} sub="your team took every trick" />
                </div>
            </Section>

            <Section title="Hand Records">
                <div className="grid grid-cols-3 gap-3">
                    <StatTile icon="local_fire_department" label="Most Count Dealt" value={s.maxHandPoints || '—'} accent={(s.maxHandPoints ?? 0) >= 40} onOpen={open('maxHandPoints')} />
                    <StatTile icon="filter_none" label="Zero-Count Hands" value={s.zeroCountHands ?? 0} />
                    <StatTile icon="linear_scale" label="Longest Suit" value={s.longestSuit || '—'} accent={(s.longestSuit ?? 0) >= 7} onOpen={open('longestSuit')} />
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                    <StatTile icon="paid" label="Points Captured" value={(s.pointsCaptured ?? 0).toLocaleString()} sub="lifetime, with your partner" />
                    <StatTile icon="celebration" label="Legendary Redeals" value={s.redealsWitnessed} accent={s.redealsWitnessed > 0} />
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                    <StatTile
                        icon="front_hand"
                        label="Earliest Laydown"
                        value={(s.earliestLaydown ?? 0) > 0 ? `Trick ${s.earliestLaydown}` : '—'}
                        accent={(s.earliestLaydown ?? 0) > 0 && s.earliestLaydown <= 4}
                        sub="soonest you claimed the rest with all winners"
                        onOpen={open('earliestLaydown')}
                    />
                    <StatTile
                        icon="done_all"
                        label="Laydowns"
                        value={s.laydowns ?? 0}
                        accent={(s.laydowns ?? 0) > 0}
                        sub="hands claimed without playing them out"
                    />
                </div>
                <div className="mt-3 rounded-xl bg-navy-950/50 border border-white/15 p-3.5">
                    <div className="text-white/60 text-[10px] font-orbitron uppercase tracking-wide mb-2">
                        Rainbows — hold all four of a number{anyRainbow ? '' : ' (none yet — keep dealing!)'}
                    </div>
                    <div className="grid grid-cols-5 gap-1.5">
                        {rainbowLedger.map(([num, n]) => (
                            <div
                                key={num}
                                className={`rounded-lg border px-1 py-1.5 text-center ${
                                    n > 0
                                        ? 'border-white/25 bg-gradient-to-b from-red-500/20 via-yellow-500/20 to-green-500/20'
                                        : 'border-white/10 bg-white/[0.03]'
                                }`}
                            >
                                <div className={`font-orbitron text-sm font-bold ${n > 0 ? 'text-white' : 'text-white/25'}`}>
                                    {n > 0 ? '🌈' : ''}{num}
                                </div>
                                <div className={`text-[10px] font-orbitron ${n > 0 ? 'text-yellow-300' : 'text-white/25'}`}>
                                    ×{n}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </Section>

            <p className="text-white/35 text-[10px] text-center mt-6 leading-relaxed">
                Hand records count games finished after the July 2026 update — older games
                didn&apos;t save what you were dealt.
            </p>
        </>
    );
}

/** THE CLIMB — the five things that rank you up, as bars. No scores,
 *  no jargon (Riley's call): each fill maps to a real ladder input, so
 *  a glance answers "what would move MY badge?" */
function ClimbSection({ profile }: { profile: UserProfile }) {
    const [climb, setClimb] = useState<ClimbStats | null>(null);
    const [drillFrac, setDrillFrac] = useState(0);
    useEffect(() => {
        climbFor(profile).then(setClimb).catch(() => {});
        listAllProgress(profile.uid).then((all) => {
            const played = all.filter((p) => p.attempts > 0);
            if (played.length) {
                setDrillFrac(Math.max(...played.map((p) => (p.layer ?? 0))) / TOP_LAYER);
            }
        }).catch(() => {});
    }, [profile]);
    if (!climb || climb.ranked === 0) return null;

    const bar = (icon: string, color: string, barColor: string, label: string, frac: number, hint: string) => (
        <div className="flex items-center gap-2.5" title={hint}>
            <span className={`material-symbols-outlined text-base ${color} w-5 flex-shrink-0`}>{icon}</span>
            <span className="text-white/70 text-[11px] font-orbitron w-32 flex-shrink-0">{label}</span>
            <span className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                <span
                    className={`block h-full rounded-full ${barColor}`}
                    style={{ width: `${Math.max(3, frac * 100)}%` }}
                />
            </span>
        </div>
    );

    return (
        <Section title="The Climb">
            <div className="rounded-xl bg-navy-950/50 border border-white/15 p-3.5 space-y-2.5">
                {bar('event_repeat', 'text-green-300', 'bg-green-400', 'Games played', climb.grind,
                    'every finished game counts — this fills all the way at 200')}
                {bar('trophy', 'text-yellow-300', 'bg-yellow-400', 'Winning big', climb.winning,
                    'wins AND the scoreboard margin — close losses barely hurt')}
                {bar('swords', 'text-red-300', 'bg-red-400', 'Tough opponents', climb.opposition,
                    'the strength of the tables you sit at — Cosmo fills it, Stomper doesn’t')}
                {bar('verified', 'text-sky-300', 'bg-sky-400', 'No assists', climb.clean,
                    'games played without the AI trainer or card counter')}
                {bar('sports_esports', 'text-fuchsia-300', 'bg-fuchsia-400', 'Mini-games', drillFrac,
                    'Beat the Bot drill tier, Bronze to GrandMaster')}
            </div>
            <p className="text-white/35 text-[10px] mt-1.5 px-1">
                These five are the whole ladder — fill the bars, wear the badge.
            </p>
        </Section>
    );
}

/** Beat the Bot training record — reads users/{uid}/minigames/*. Only
 *  renders once the player has played at least one drill situation. */
function BeatTheBotCase({ uid }: { uid: string }) {
    const router = useRouter();
    const [all, setAll] = useState<MiniGameProgress[] | null>(null);
    useEffect(() => {
        listAllProgress(uid).then(setAll).catch(() => setAll([]));
    }, [uid]);
    if (!all || all.length === 0) return null;

    const sum = all.reduce((acc, p) => ({
        attempts: acc.attempts + p.attempts,
        perfect: acc.perfect + p.perfect,
        selTotal: acc.selTotal + (p.selTotal ?? 0),
        selMatch: acc.selMatch + (p.selMatch ?? 0),
        bestStreak: Math.max(acc.bestStreak, p.bestStreak),
    }), { attempts: 0, perfect: 0, selTotal: 0, selMatch: 0, bestStreak: 0 });
    if (sum.attempts === 0) return null;

    const played = all.filter((p) => p.attempts > 0);
    const bestLayer = Math.max(0, ...played.map((p) => p.layer ?? 0));
    const bestTier = LAYER_TIERS[Math.min(bestLayer, TOP_LAYER)];
    const drillName: Record<string, string> = { godown: 'Go-Down', lead: 'First Card' };
    const agree = selectionPct(sum);
    const badges: Array<[string, string, boolean]> = [
        ['neurology', 'MIND MELD', sum.perfect >= 25],
        ['smart_toy', 'BOT WHISPERER', agree >= 90 && sum.attempts >= 50],
        ['local_fire_department', 'HOT STREAK ×10', sum.bestStreak >= 10],
    ];
    const earned = badges.filter(([, , ok]) => ok);

    return (
        <Section title="Beat the Bot">
            <button
                onClick={() => router.push('/minigames')}
                className="w-full rounded-xl bg-navy-950/50 border border-fuchsia-500/30 hover:border-fuchsia-400/60 p-3.5 transition text-left"
            >
                <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-fuchsia-400 text-3xl">sports_esports</span>
                    <div className="flex-1">
                        <div className="font-orbitron text-white text-sm font-bold">
                            <span className={bestTier.color}>{bestTier.emoji} {bestTier.name}</span> driller
                        </div>
                        <div className="text-white/50 text-[11px] mt-0.5">
                            {played.map((p) => {
                                const t = LAYER_TIERS[Math.min(p.layer ?? 0, TOP_LAYER)];
                                return `${drillName[p.game] ?? p.game} ${t.emoji} ${t.name}`;
                            }).join(' · ')}
                        </div>
                        <div className="text-white/50 text-[11px] mt-0.5">
                            {sum.attempts} situations played · best streak {sum.bestStreak}
                        </div>
                        {sum.selTotal > 0 && (
                            <div className="text-white/50 text-[11px] mt-0.5">
                                Fun fact: agrees with the bot on <b className="text-fuchsia-300">{agree}%</b> of selections
                            </div>
                        )}
                    </div>
                </div>
                {earned.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                        {earned.map(([icon, label]) => (
                            <span key={label} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-200 font-orbitron text-[10px] font-bold">
                                <span className="material-symbols-outlined text-[12px]">{icon}</span>
                                {label}
                            </span>
                        ))}
                    </div>
                )}
            </button>
        </Section>
    );
}

/** The crown jewel: a real-world JAY CUP title, granted by hand to verified
 *  winners (see UserProfile.jayCupYears). Styled after the walnut-and-silver
 *  trophy itself. */
function JayCupTrophy({ years }: { years: number[] }) {
    return (
        <div className="relative mb-6 rounded-xl bg-gradient-to-b from-[#3b2314] to-[#241209] border border-[#5a3a22] p-1.5 shadow-lg overflow-hidden">
            <ConfettiBurst count={22} spread={160} origin={{ x: 50, y: 40 }} />
            <div className="rounded-lg bg-black/85 border border-gray-500/40 px-4 py-4 text-center">
                <span
                    className="material-symbols-outlined text-5xl animate-trophy-shine"
                    style={{
                        background: 'linear-gradient(160deg, #f8fafc 10%, #94a3b8 45%, #e2e8f0 60%, #64748b 90%)',
                        WebkitBackgroundClip: 'text',
                        backgroundClip: 'text',
                        color: 'transparent',
                    }}
                >
                    trophy
                </span>
                <div className="font-serif text-gray-100 text-lg font-bold tracking-[0.25em] mt-1">
                    JAY CUP CHAMPION
                </div>
                <div className="text-yellow-300/90 font-orbitron text-sm font-bold mt-1">
                    {[...years].sort((a, b) => a - b).join(' · ')}
                </div>
                <div className="text-gray-400 text-[10px] tracking-wide mt-1.5">
                    Gardner Family Rook Tournament — verified champion
                </div>
            </div>
        </div>
    );
}

function ProfileInner() {
    const { user, loading } = useAuth();
    const router = useRouter();
    const params = useSearchParams();
    const requestedUid = params.get('uid');
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [fetched, setFetched] = useState(false);
    const [skill, setSkill] = useState<SkillResult | null>(null);

    useEffect(() => {
        if (!loading && !user) router.push('/');
    }, [user, loading, router]);

    const uid = requestedUid || user?.uid || null;
    const isMe = !!user && uid === user.uid;

    useEffect(() => {
        if (!user || !uid) return;
        setFetched(false);
        getUserProfile(uid)
            .then((p) => {
                setProfile(p);
                if (p) skillFor(p).then(setSkill).catch(() => {});
            })
            .catch(() => setProfile(null))
            .finally(() => setFetched(true));
    }, [user, uid]);

    if (loading || !user || !fetched) {
        return <LoadingPage title="Rook13" subtitle="Opening the trophy case…" />;
    }

    const s = profile?.stats;
    const name = isMe ? (user.displayName || 'Player') : (profile?.displayName || 'Player');
    const photo = isMe ? user.photoURL : profile?.photoURL;

    return (
        <div className="min-h-dvh bg-navy-900">
            <div className="max-w-md mx-auto px-4 py-5 pb-10">
                <div className="flex items-center justify-between mb-6">
                    <button onClick={() => router.back()} className="text-white/70 hover:text-white flex items-center gap-1 font-orbitron text-sm">
                        <span className="material-symbols-outlined">arrow_back</span> Back
                    </button>
                    <span className="font-orbitron font-bold text-white">ROOK<span className="text-yellow-400">13</span></span>
                </div>

                {!isMe && !profile ? (
                    <div className="text-center text-white/60 font-orbitron text-sm py-12">
                        Player not found.
                    </div>
                ) : (
                    <>
                        <div className="flex flex-col items-center mb-7">
                            {photo ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={photo} alt="" className="w-20 h-20 rounded-full border-4 border-yellow-400/40" referrerPolicy="no-referrer" />
                            ) : (
                                <div className="w-20 h-20 rounded-full bg-navy-950 border-4 border-yellow-400/40 flex items-center justify-center text-white font-orbitron text-3xl">
                                    {name.charAt(0)}
                                </div>
                            )}
                            <h1 className="font-orbitron text-white text-xl font-bold mt-3">{name}</h1>
                            {s && s.gamesPlayed > 0 && skill && (() => {
                                const rank = ladderRank(skill, s);
                                return (
                                    <div className="mt-1 flex flex-col items-center">
                                        <div className="text-sm">
                                            <RankBadge rank={rank} />
                                            {skill.provisional && (
                                                <span className="text-white/40 font-orbitron text-[11px]"> · 🐣 placements</span>
                                            )}
                                        </div>
                                        {/* the climb to the next badge — no numbers, just the bar */}
                                        {!skill.provisional && rank.next && (
                                            <span className="block mt-1.5 h-1 w-36 rounded-full bg-white/10 overflow-hidden" title={`climbing toward ${rank.next.name}`}>
                                                <span
                                                    className={`block h-full rounded-full ${rank.tier.bar}`}
                                                    style={{ width: `${Math.max(4, rank.progress * 100)}%` }}
                                                />
                                            </span>
                                        )}
                                        {rank.locked && (
                                            <span className="text-white/40 text-[10px] mt-1">
                                                <span className="material-symbols-outlined text-[10px] align-middle">lock</span>
                                                {' '}plays like a {rank.locked.tier.emoji} {rank.locked.tier.name} —
                                                the badge comes with more games
                                            </span>
                                        )}
                                    </div>
                                );
                            })()}
                            <div className="flex items-center gap-1.5 text-yellow-400/90 font-orbitron text-[11px] uppercase tracking-widest mt-1">
                                <span className="material-symbols-outlined text-sm">trophy</span>
                                Trophy Case
                            </div>
                        </div>

                        {profile?.jayCupYears && profile.jayCupYears.length > 0 && (
                            <JayCupTrophy years={profile.jayCupYears} />
                        )}

                        {!s || s.gamesPlayed === 0 ? (
                            <>
                                <div className="text-center text-white/60 font-orbitron text-sm py-8">
                                    {isMe ? 'No finished games yet — go play a hand!' : `${name} hasn't finished a game yet.`}
                                </div>
                                {uid && <BeatTheBotCase uid={uid} />}
                            </>
                        ) : (
                            <>
                                {profile && <ClimbSection profile={profile} />}
                                <TrophyCase
                                    s={s}
                                    openRef={(r) => {
                                        if (!r) return;
                                        router.push(`/review?id=${r.gameId}${r.hand ? `&hand=${r.hand}` : ''}`);
                                    }}
                                />
                                {uid && <BeatTheBotCase uid={uid} />}
                                {uid && <RecentGames uid={uid} />}
                            </>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

export default function ProfilePage() {
    return (
        <Suspense fallback={<LoadingPage title="Rook13" subtitle="Opening the trophy case…" />}>
            <ProfileInner />
        </Suspense>
    );
}
