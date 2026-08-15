'use client';

// MINI GAMES — Beat the Bot. Fast training drills against the strongest
// brain in the building: every situation is pre-answered offline by
// Gen26+DayDream at a pinned world count (see ml/alpharook/minigame_mill.py),
// so the reveal is instant. Two drills: the go-down and the opening lead.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { levelFor, selectionPct } from '@/lib/minigames/scoring';
import { listAllProgress } from '@/lib/minigames/service';
import { Bank, GoDownItem, LeadItem, MiniGameProgress, emptyProgress, loadBank } from '@/lib/minigames/types';

function DrillCard({ href, icon, title, blurb, p, total }: {
    href: string; icon: string; title: string; blurb: string;
    p: MiniGameProgress; total: number | null;
}) {
    const router = useRouter();
    const started = p.attempts > 0;
    const done = total !== null && total > 0 && p.done.length >= total;
    return (
        <button
            onClick={() => router.push(href)}
            className="w-full rounded-2xl border border-fuchsia-500/40 bg-gradient-to-r from-fuchsia-500/10 to-transparent p-4 text-left hover:border-fuchsia-400 transition"
        >
            <div className="flex items-center gap-4">
                <span className="material-symbols-outlined text-fuchsia-400 text-4xl">{icon}</span>
                <div className="flex-1 min-w-0">
                    <div className="font-orbitron text-white font-bold">{title}</div>
                    <div className="text-white/60 text-xs mt-0.5">{blurb}</div>
                </div>
                <span className="material-symbols-outlined text-white/30">chevron_right</span>
            </div>
            <div className="flex items-center gap-2 mt-3 text-[11px] font-orbitron">
                {started ? (
                    <>
                        <span className="px-2 py-0.5 rounded-md bg-white/10 text-white/80">
                            {p.attempts} played
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-white/5 text-white/50">
                            best streak {p.bestStreak}
                        </span>
                    </>
                ) : (
                    <span className="px-2 py-0.5 rounded-md bg-fuchsia-500/15 text-fuchsia-300">
                        new — jump in
                    </span>
                )}
                <span className="ml-auto text-white/50">
                    {done ? 'ALL DONE 🏁' : total !== null ? `${p.done.length}/${total}` : '…'}
                </span>
            </div>
        </button>
    );
}

export default function MiniGamesPage() {
    const { user, loading } = useAuth();
    const router = useRouter();
    const [progress, setProgress] = useState<Record<string, MiniGameProgress>>({
        godown: emptyProgress('godown'), lead: emptyProgress('lead'),
    });
    const [totals, setTotals] = useState<{ godown: number | null; lead: number | null }>({
        godown: null, lead: null,
    });

    useEffect(() => {
        if (!loading && !user) router.push('/');
    }, [user, loading, router]);

    useEffect(() => {
        if (!user) return;
        listAllProgress(user.uid).then((all) => {
            setProgress((prev) => {
                const next = { ...prev };
                for (const p of all) next[p.game] = p;
                return next;
            });
        }).catch(() => {});
        loadBank<GoDownItem>('godown')
            .then((b: Bank<GoDownItem>) => setTotals((t) => ({ ...t, godown: b.items.length })))
            .catch(() => setTotals((t) => ({ ...t, godown: 0 })));
        loadBank<LeadItem>('lead')
            .then((b: Bank<LeadItem>) => setTotals((t) => ({ ...t, lead: b.items.length })))
            .catch(() => setTotals((t) => ({ ...t, lead: 0 })));
    }, [user]);

    if (loading || !user) return null;

    const combined = (['godown', 'lead'] as const).reduce(
        (acc, g) => ({
            attempts: acc.attempts + progress[g].attempts,
            selTotal: acc.selTotal + (progress[g].selTotal ?? 0),
            selMatch: acc.selMatch + (progress[g].selMatch ?? 0),
        }),
        { attempts: 0, selTotal: 0, selMatch: 0 },
    );
    const lv = levelFor(combined.attempts);

    return (
        <main className="min-h-dvh bg-navy-900">
            <div className="max-w-md mx-auto px-4 py-5 pb-16">
                <div className="flex items-center justify-between mb-6">
                    <button onClick={() => router.push('/')} className="text-white/70 hover:text-white flex items-center gap-1 font-orbitron text-sm">
                        <span className="material-symbols-outlined">arrow_back</span> Back
                    </button>
                    <span className="font-orbitron font-bold text-white">ROOK<span className="text-yellow-400">13</span></span>
                </div>

                <div className="text-center mb-6">
                    <span className="material-symbols-outlined text-fuchsia-400 text-5xl">sports_esports</span>
                    <h1 className="font-orbitron text-white text-2xl font-bold mt-1">
                        BEAT THE <span className="text-fuchsia-400">BOT</span>
                    </h1>
                    <p className="text-white/60 text-sm mt-2 leading-relaxed">
                        Real situations, one after another. You make the call, then see
                        what the strongest bot in the family would have done.
                    </p>
                </div>

                {combined.attempts > 0 && (
                    <div className="rounded-xl bg-navy-950/50 border border-white/15 p-3 mb-4 text-center">
                        <div className="font-orbitron text-2xl font-bold text-fuchsia-300">
                            LEVEL {lv.level} · {lv.name.toUpperCase()}
                        </div>
                        <div className="text-white/60 text-[11px] font-orbitron uppercase tracking-wide">
                            {combined.attempts} situations played
                            {lv.next !== null && ` · ${lv.next - combined.attempts} to level ${lv.level + 1}`}
                        </div>
                        {combined.selTotal > 0 && (
                            <div className="text-white/50 text-[11px] mt-1.5">
                                Fun fact! You and the bot agree on{' '}
                                <b className="text-fuchsia-300">{selectionPct(combined)}%</b> of selections.
                            </div>
                        )}
                    </div>
                )}

                <div className="space-y-3">
                    <DrillCard
                        href="/minigames/godown"
                        icon="archive"
                        title="THE GO-DOWN"
                        blurb="You bought the bid. Call trump, bury four — beat my burial."
                        p={progress.godown}
                        total={totals.godown}
                    />
                    <DrillCard
                        href="/minigames/lead"
                        icon="playing_cards"
                        title="THE FIRST CARD"
                        blurb="The opening lead, from every seat at the table. Pick better than me."
                        p={progress.lead}
                        total={totals.lead}
                    />
                </div>

                <p className="text-white/35 text-[10px] text-center mt-6 leading-relaxed">
                    Every answer was searched ahead of time by Gen26+DayDream over
                    hundreds of imagined worlds — no waiting, just play.
                </p>
            </div>
        </main>
    );
}
