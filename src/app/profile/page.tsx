'use client';

// The Trophy Case: lifetime stats at /profile (yours) or /profile?uid=…
// (anyone else's — it's a family game, everyone's case is on display).

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { getUserProfile, UserProfile, UserStats } from '@/lib/firebase/userService';
import LoadingPage from '@/components/LoadingPage';

const pct = (num: number, den: number) => (den > 0 ? `${Math.round((num / den) * 100)}%` : '—');

function StatTile({ icon, label, value, accent, sub }: {
    icon: string;
    label: string;
    value: string | number;
    accent?: boolean;
    sub?: string;
}) {
    return (
        <div className="rounded-xl bg-navy-950/50 border border-white/15 p-3 text-center">
            <span className={`material-symbols-outlined text-xl ${accent ? 'text-yellow-400' : 'text-white/40'}`}>{icon}</span>
            <div className={`font-orbitron text-xl font-bold leading-tight ${accent ? 'text-yellow-400' : 'text-white'}`}>{value}</div>
            <div className="text-white/60 text-[10px] font-orbitron uppercase tracking-wide mt-0.5">{label}</div>
            {sub && <div className="text-white/40 text-[10px] mt-0.5">{sub}</div>}
        </div>
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

function TrophyCase({ s }: { s: UserStats }) {
    const madeBids = Object.entries(s.madeByBid ?? {})
        .map(([bid, n]) => [Number(bid), n] as [number, number])
        .sort((a, b) => b[0] - a[0]);
    const rainbows = Object.entries(s.rainbowCounts ?? {})
        .map(([num, n]) => [Number(num), n] as [number, number])
        .sort((a, b) => b[0] - a[0]);

    return (
        <>
            <div className="grid grid-cols-3 gap-3">
                <StatTile icon="playing_cards" label="Games" value={s.gamesPlayed} />
                <StatTile icon="emoji_events" label="Wins" value={s.gamesWon} />
                <StatTile icon="percent" label="Win Rate" value={pct(s.gamesWon, s.gamesPlayed)} accent />
            </div>

            <Section title="At the Auction">
                <div className="grid grid-cols-3 gap-3">
                    <StatTile icon="gavel" label="Bids Won" value={s.bidsWon} />
                    <StatTile icon="task_alt" label="Made Its" value={s.bidsMade} />
                    <StatTile icon="percent" label="Bid Success" value={pct(s.bidsMade, s.bidsWon)} />
                </div>
                <div className="grid grid-cols-3 gap-3 mt-3">
                    <StatTile icon="trending_up" label="Highest Bid" value={s.highestBid || '—'} />
                    <StatTile icon="workspace_premium" label="Best Bid Made" value={s.highestBidMade || '—'} accent />
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
                    <StatTile icon="local_fire_department" label="Most Count Dealt" value={s.maxHandPoints || '—'} accent={(s.maxHandPoints ?? 0) >= 40} />
                    <StatTile icon="filter_none" label="Zero-Count Hands" value={s.zeroCountHands ?? 0} />
                    <StatTile icon="linear_scale" label="Longest Suit" value={s.longestSuit || '—'} accent={(s.longestSuit ?? 0) >= 7} />
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                    <StatTile icon="paid" label="Points Captured" value={(s.pointsCaptured ?? 0).toLocaleString()} sub="lifetime, with your partner" />
                    <StatTile icon="celebration" label="Legendary Redeals" value={s.redealsWitnessed} accent={s.redealsWitnessed > 0} />
                </div>
                {rainbows.length > 0 && (
                    <div className="mt-3 rounded-xl bg-navy-950/50 border border-white/15 p-3.5">
                        <div className="text-white/60 text-[10px] font-orbitron uppercase tracking-wide mb-2">
                            Rainbows — all four of a number, one deal
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {rainbows.map(([num, n]) => (
                                <span key={num} className="px-2.5 py-1 rounded-full bg-gradient-to-r from-red-500/25 via-yellow-500/25 to-green-500/25 border border-white/20 text-white font-orbitron text-xs font-bold">
                                    Rainbow {num}{n > 1 ? ` ×${n}` : ''}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </Section>

            <p className="text-white/35 text-[10px] text-center mt-6 leading-relaxed">
                Hand records count games finished after the July 2026 update — older games
                didn&apos;t save what you were dealt.
            </p>
        </>
    );
}

function ProfileInner() {
    const { user, loading } = useAuth();
    const router = useRouter();
    const params = useSearchParams();
    const requestedUid = params.get('uid');
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [fetched, setFetched] = useState(false);

    useEffect(() => {
        if (!loading && !user) router.push('/');
    }, [user, loading, router]);

    const uid = requestedUid || user?.uid || null;
    const isMe = !!user && uid === user.uid;

    useEffect(() => {
        if (!user || !uid) return;
        setFetched(false);
        getUserProfile(uid)
            .then(setProfile)
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
                            <div className="flex items-center gap-1.5 text-yellow-400/90 font-orbitron text-[11px] uppercase tracking-widest mt-1">
                                <span className="material-symbols-outlined text-sm">trophy</span>
                                Trophy Case
                            </div>
                        </div>

                        {!s || s.gamesPlayed === 0 ? (
                            <div className="text-center text-white/60 font-orbitron text-sm py-8">
                                {isMe ? 'No finished games yet — go play a hand!' : `${name} hasn't finished a game yet.`}
                            </div>
                        ) : (
                            <TrophyCase s={s} />
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
