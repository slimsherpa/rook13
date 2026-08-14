'use client';

// BEAT THE BOT — THE FIRST CARD. The opening lead, filtered by where
// the buyer sits relative to you. Tap the card you'd lead, lock it,
// and the pre-searched Gen26+DayDream lead is revealed with per-card
// values (the fill circles — how good each lead really was).

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import PlayingCard from '@/components/ui/PlayingCard';
import { useAuth } from '@/lib/hooks/useAuth';
import { SUITS } from '@/lib/game/types';
import { sortHand } from '@/lib/game/deck';
import { AllDoneCard, FeedbackBanner, ScoreStrip, SUIT_BG, TableMap } from '@/components/minigames/shared';
import { Grade, gradeLead } from '@/lib/minigames/scoring';
import { getProgress, recordAttempt } from '@/lib/minigames/service';
import { Bank, LeadItem, MiniGameProgress, emptyProgress, loadBank, toCard, toInt } from '@/lib/minigames/types';

const BUYER_LABEL = [
    'You bought it — lead into your own contract',
    'The buyer is on your LEFT (plays right after you)',
    'Your PARTNER bought it — lead into their contract',
    'The buyer is on your RIGHT (plays last behind you)',
];

const SEAT_TABS: Array<[number | null, string]> = [
    [null, 'Mix'], [0, 'I bought'], [2, 'Partner'], [1, 'Left'], [3, 'Right']];

export default function LeadDrill() {
    const { user, loading } = useAuth();
    const router = useRouter();
    const [bank, setBank] = useState<Bank<LeadItem> | null>(null);
    const [progress, setProgress] = useState<MiniGameProgress>(emptyProgress('lead'));
    const [ready, setReady] = useState(false);
    const [seat, setSeat] = useState<number | null>(null);
    const [picked, setPicked] = useState<number | null>(null);
    const [grade, setGrade] = useState<Grade | null>(null);

    useEffect(() => {
        if (!loading && !user) router.push('/');
    }, [user, loading, router]);

    useEffect(() => {
        if (!user) return;
        Promise.all([loadBank<LeadItem>('lead'), getProgress(user.uid, 'lead')])
            .then(([b, p]) => { setBank(b); setProgress(p); setReady(true); })
            .catch(() => { setBank({ meta: { gen: '?', k: 0, updated: '', count: 0 }, items: [] }); setReady(true); });
    }, [user]);

    const doneSet = useMemo(() => new Set(progress.done), [progress.done]);
    const pool = useMemo(() => {
        if (!bank) return [];
        return seat === null
            ? bank.items
            : bank.items.filter((it) => it.buyerRel === seat);
    }, [bank, seat]);
    const item = useMemo(
        () => pool.find((it) => !doneSet.has(it.id)) ?? null,
        [pool, doneSet],
    );

    const hand9 = useMemo(() => {
        if (!item) return [] as number[];
        return sortHand(item.cards.map(toCard), SUITS[item.trump]).map(toInt);
    }, [item]);

    if (loading || !user || !ready) return null;

    const revealed = grade !== null;

    const seatTabs = (
        <div className="flex gap-1.5 mt-4 mb-3 flex-wrap">
            {SEAT_TABS.map(([rel, label]) => {
                const grp = rel === null ? bank?.items ?? [] : (bank?.items ?? []).filter((it) => it.buyerRel === rel);
                const n = grp.filter((it) => doneSet.has(it.id)).length;
                return (
                    <button key={label}
                        onClick={() => { setSeat(rel); setPicked(null); setGrade(null); }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition
                            ${seat === rel
                                ? 'border-fuchsia-400 text-fuchsia-300 bg-white/5'
                                : 'border-white/15 text-white/50 hover:text-white'}`}>
                        {label} <span className="font-normal opacity-70">{n}/{grp.length}</span>
                    </button>
                );
            })}
        </div>
    );

    const header = (
        <div className="flex items-center gap-3 mb-4">
            <button onClick={() => router.push('/minigames')} className="text-white/50 text-sm hover:text-white">← Mini Games</button>
            <h1 className="font-orbitron text-fuchsia-400 text-lg font-bold">The First Card</h1>
        </div>
    );

    if (!item) {
        return (
            <main className="min-h-dvh bg-gradient-to-b from-navy-900 to-navy-950 px-4 py-5">
                <div className="max-w-md mx-auto">
                    {header}
                    {bank && bank.items.length > 0 ? (
                        <>
                            {seatTabs}
                            {pool.length > 0 && pool.every((it) => doneSet.has(it.id)) && seat !== null
                                ? <div className="text-white/60 text-sm">This seat is done — pick another above.</div>
                                : <AllDoneCard title="FIRST CARD MASTERED" />}
                        </>
                    ) : (
                        <div className="text-white/60 text-sm">No situations loaded yet — the first batch is still milling on Riley&apos;s Mac.</div>
                    )}
                </div>
            </main>
        );
    }

    const trumpSuit = SUITS[item.trump];
    const values = item.bot.values;
    const vals = Object.values(values);
    const vmin = Math.min(...vals);
    const vmax = Math.max(...vals);
    const frac = (c: number) => {
        const v = values[String(c)];
        if (v === undefined || vmax === vmin) return 0;
        return Math.max(0.05, (v - vmin) / (vmax - vmin));
    };

    const lock = async () => {
        if (picked === null || revealed) return;
        const g = gradeLead(item, picked);
        setGrade(g);
        const next = await recordAttempt(user.uid, progress, item.id, g);
        setProgress(next);
    };
    const nextItem = () => { setPicked(null); setGrade(null); };

    return (
        <main className="min-h-dvh bg-gradient-to-b from-navy-900 to-navy-950 px-4 py-5 pb-16">
            <div className="max-w-md mx-auto">
                {header}
                <ScoreStrip p={progress} total={bank?.items.length ?? 0} />
                {seatTabs}

                <div className="flex items-center gap-3 mb-2">
                    <div className="text-white/70 text-sm">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold text-white mr-2 ${SUIT_BG[item.trump]}`}>
                            {trumpSuit} trump
                        </span>
                        bid <b className="text-white">{item.bid}</b>
                        <span className="text-white/40"> · </span>
                        <b className="text-white">{item.scores[0]}–{item.scores[1]}</b>
                    </div>
                    <div className="ml-auto"><TableMap mark="$" markRel={item.buyerRel} /></div>
                </div>
                <div className="text-fuchsia-300/90 text-sm mb-3">{BUYER_LABEL[item.buyerRel]}</div>

                <div className="text-white/50 text-xs uppercase tracking-wider mb-1.5">
                    Your lead — tap a card
                </div>
                <div className="flex flex-wrap justify-center gap-1.5 gap-y-3 mb-4 pt-4">
                    {hand9.map((c) => {
                        const bots = revealed && item.bot.card === c;
                        return (
                            <div key={c} className="relative flex flex-col items-center gap-1">
                                <div className={bots ? 'rounded-lg outline outline-2 outline-offset-2 outline-pink-400' : 'rounded-lg'}>
                                    <PlayingCard
                                        card={toCard(c)} trump={trumpSuit} size="sm"
                                        onClick={() => !revealed && setPicked(c)}
                                        selected={!revealed && picked === c}
                                        highlight={revealed && picked === c}
                                    />
                                </div>
                                {revealed && (
                                    <span
                                        className="w-4 h-4 rounded-full"
                                        title={`value ${values[String(c)] ?? '?'}`}
                                        style={{
                                            background: `conic-gradient(#e85d8a ${(frac(c) * 360).toFixed(0)}deg, rgba(255,255,255,.15) 0)`,
                                        }}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>

                {!revealed ? (
                    <button
                        onClick={lock}
                        disabled={picked === null}
                        className={`w-full py-3.5 rounded-xl font-orbitron text-sm font-bold active:scale-[0.98] transition
                            ${picked !== null ? 'bg-fuchsia-600 hover:bg-fuchsia-500 text-white' : 'bg-white/10 text-white/30'}`}>
                        {picked !== null ? 'LOCK IT IN' : 'Tap the card you’d lead'}
                    </button>
                ) : (
                    <>
                        <div className="text-xs text-white/60 mb-2">
                            <span className="text-pink-300 font-bold">pink ring</span> = my lead ·
                            fill circles = how each lead priced over {item.k} worlds
                        </div>
                        <FeedbackBanner grade={grade} k={item.k} />
                        <button
                            onClick={nextItem}
                            className="w-full mt-3 py-3.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-orbitron text-sm font-bold active:scale-[0.98] transition">
                            NEXT LEAD →
                        </button>
                    </>
                )}
            </div>
        </main>
    );
}
