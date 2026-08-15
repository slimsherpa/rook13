'use client';

// BEAT THE BOT — THE FIRST CARD. The opening lead exactly as the table
// deals it: trump already called (the background IS the trump color,
// like the real game), your nine fanned at the bottom, tap the card
// you'd lead — it plays instantly, real-table style — and the
// pre-searched Gen26+DayDream answer reveals with assist dials showing
// how every lead priced.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import PlayingCard from '@/components/ui/PlayingCard';
import LoadingPage from '@/components/LoadingPage';
import { useAuth } from '@/lib/hooks/useAuth';
import { SUITS } from '@/lib/game/types';
import { sortHand } from '@/lib/game/deck';
import { themeFor, themeForPalette } from '@/components/table/theme';
import { paletteById } from '@/lib/game/palettes';
import { useCardPaletteId } from '@/lib/settings';
import { AllDoneCard, RevealCard, ScoreStrip, TableMap, ValueDial } from '@/components/minigames/shared';
import { cardName, critiqueLead, explainLead } from '@/lib/minigames/explain';
import { Grade, gradeLead } from '@/lib/minigames/scoring';
import { getProgress, recordAttempt } from '@/lib/minigames/service';
import { Bank, LeadItem, MiniGameProgress, emptyProgress, loadBank, toCard, toInt } from '@/lib/minigames/types';

const BUYER_LABEL = [
    'You bought it — lead into your own contract',
    'The buyer is on your LEFT (plays right after you)',
    'Your PARTNER bought it — lead into their contract',
    'The buyer is on your RIGHT (plays last behind you)',
];

const SEAT_TABS: Array<[number, string]> = [
    [2, 'Partner'], [0, 'I bought'], [1, 'Left'], [3, 'Right']];

export default function LeadDrill() {
    const { user, loading } = useAuth();
    const router = useRouter();
    const [bank, setBank] = useState<Bank<LeadItem> | null>(null);
    const [progress, setProgress] = useState<MiniGameProgress>(emptyProgress('lead'));
    const [ready, setReady] = useState(false);
    const [progReady, setProgReady] = useState(false);
    const [seat, setSeat] = useState<number>(2);   // partner leads the drill
    const [picked, setPicked] = useState<number | null>(null);
    const [grade, setGrade] = useState<Grade | null>(null);
    // held until "next lead" — deriving from the done-set would advance
    // the position mid-reveal (grading marks it done immediately)
    const [itemId, setItemId] = useState<number | null>(null);

    useEffect(() => {
        if (!loading && !user) router.push('/');
    }, [user, loading, router]);

    useEffect(() => {
        if (!user) return;
        // bank and progress load independently: a progress failure must
        // never block play (the service falls back to localStorage)
        loadBank<LeadItem>('lead')
            .then(setBank)
            .catch(() => setBank({ meta: { gen: '?', k: 0, updated: '', count: 0 }, items: [] }))
            .finally(() => setReady(true));
        getProgress(user.uid, 'lead')
            .then(setProgress)
            .catch(() => {})
            .finally(() => setProgReady(true));
    }, [user]);

    const [paletteId] = useCardPaletteId();
    const doneSet = useMemo(() => new Set(progress.done), [progress.done]);
    const pool = useMemo(
        () => (bank ? bank.items.filter((it) => it.buyerRel === seat) : []),
        [bank, seat],
    );
    const item = useMemo(() => {
        if (itemId !== null) return pool.find((it) => it.id === itemId) ?? null;
        return pool.find((it) => !doneSet.has(it.id)) ?? null;
    }, [pool, doneSet, itemId]);
    // pin the first fresh situation once BOTH loads settle (pinning off
    // the initial empty progress would re-deal an already-done lead)
    useEffect(() => {
        if (progReady && itemId === null && item) setItemId(item.id);
    }, [item, itemId, progReady]);

    const hand9 = useMemo(() => {
        if (!item) return [] as number[];
        return sortHand(item.cards.map(toCard), SUITS[item.trump]).map(toInt);
    }, [item]);

    if (loading || !user || !ready || !progReady) {
        return <LoadingPage title="Rook13" subtitle="Shuffling situations…" />;
    }

    const revealed = grade !== null;
    const theme = themeForPalette(item ? SUITS[item.trump] : null, paletteById(paletteId));

    const header = (
        <div className="flex items-center gap-3 mb-3">
            <button onClick={() => router.push('/minigames')} className="text-white/70 text-sm hover:text-white flex items-center gap-1 font-orbitron">
                <span className="material-symbols-outlined text-lg">arrow_back</span>
                Mini Games
            </button>
            <h1 className="font-orbitron text-white text-base font-bold ml-auto">
                THE FIRST <span className="text-yellow-400">CARD</span>
            </h1>
        </div>
    );

    const seatTabs = (
        <div className="flex gap-1.5 mt-3 flex-wrap">
            {SEAT_TABS.map(([rel, label]) => {
                const grp = (bank?.items ?? []).filter((it) => it.buyerRel === rel);
                const n = grp.filter((it) => doneSet.has(it.id)).length;
                return (
                    <button key={label}
                        onClick={() => { setSeat(rel); setPicked(null); setGrade(null); setItemId(null); }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition font-orbitron
                            ${seat === rel
                                ? 'border-yellow-300 text-yellow-200 bg-black/25'
                                : 'border-white/25 text-white/60 hover:text-white bg-black/10'}`}>
                        {label} <span className="font-normal opacity-70">{n}/{grp.length}</span>
                    </button>
                );
            })}
        </div>
    );

    if (!item) {
        return (
            <main className="min-h-dvh px-4 py-5" style={{ background: themeFor(null).bg }}>
                <div className="max-w-md mx-auto">
                    {header}
                    {bank && bank.items.length > 0 ? (
                        <>
                            {seatTabs}
                            {bank.items.every((it) => doneSet.has(it.id))
                                ? <AllDoneCard title="FIRST CARD MASTERED" />
                                : <div className="text-white/70 text-sm text-center mt-10 font-orbitron">This seat is done — pick another above.</div>}
                        </>
                    ) : (
                        <div className="text-white/70 text-sm text-center mt-10 font-orbitron">
                            No situations loaded — check back in a minute.
                        </div>
                    )}
                </div>
            </main>
        );
    }

    const values = item.bot.values;
    const vals = Object.values(values);
    const vmin = Math.min(...vals);
    const vmax = Math.max(...vals);
    const frac = (c: number) => {
        const v = values[String(c)];
        if (v === undefined || vmax === vmin) return 0;
        return Math.max(0.05, (v - vmin) / (vmax - vmin));
    };

    // real-table feel: tapping a card IS the play
    const play = (c: number) => {
        if (revealed) return;
        setPicked(c);
        const g = gradeLead(item, c);
        setGrade(g);
        setProgress(recordAttempt(user.uid, progress, item.id, g));
    };
    const nextItem = () => { setPicked(null); setGrade(null); setItemId(null); };

    return (
        <main
            className="min-h-dvh flex flex-col transition-colors duration-500"
            style={{ background: theme.bg }}
        >
            <div className="w-full max-w-md mx-auto px-4 pt-4 flex-none">
                {header}
                <ScoreStrip p={progress} total={bank?.items.length ?? 0} />
                {seatTabs}
                <div className="flex items-center gap-3 mt-3">
                    <div className="text-white/90 font-orbitron text-sm">
                        Bid <b className="text-yellow-300">{item.bid}</b>
                        <div className="text-white/70 text-[11px] font-sans mt-0.5 max-w-[190px]">
                            {BUYER_LABEL[item.buyerRel]}
                        </div>
                    </div>
                    <div className="ml-auto"><TableMap mark="$" markRel={item.buyerRel} /></div>
                </div>
            </div>

            {/* the middle of the table: the reveal lands here */}
            <div className="flex-1 flex items-center justify-center px-4 py-3">
                {revealed && grade ? (
                    <RevealCard grade={grade} k={item.k} onNext={nextItem} nextLabel="NEXT LEAD">
                        <div className="text-white/70 text-xs mt-2">
                            <span className="font-bold" style={{ color: '#ff2d95' }}>pink bar</span> = my lead ·
                            the dials show how every card priced over {item.k} worlds
                        </div>
                        {(() => {
                            const why = grade.tier !== 'perfect' ? explainLead(item) : null;
                            const yours = picked !== null ? critiqueLead(item, picked) : null;
                            // when the biggest dial isn't the pick: the searcher
                            // only overrules its instinct on CONFIRMED evidence
                            // (the tau law) — say so in plain language
                            const best = Object.entries(values)
                                .sort((a, b) => b[1] - a[1])[0];
                            // ">" with a real margin: a twin with an equal
                            // value is the same card, not a better one
                            const stuck = best && Number(best[0]) !== item.bot.card
                                && best[1] > (values[String(item.bot.card)] ?? -Infinity) + 0.05;
                            if (!why && !yours && !stuck) return null;
                            return (
                                <div className="text-white/60 text-xs mt-2 border-t border-white/10 pt-2 space-y-1.5">
                                    {why && <div>{why}</div>}
                                    {yours && <div>{yours}</div>}
                                    {stuck && (
                                        <div>
                                            The {cardName(Number(best[0]))} actually priced a touch
                                            higher across these worlds — but not by enough to be
                                            sure, so I stuck with my instinct: the {cardName(item.bot.card)}.
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                    </RevealCard>
                ) : (
                    <div className="text-white/60 font-orbitron text-xs text-center">
                        You lead trick 1 — tap the card you&apos;d play
                    </div>
                )}
            </div>

            {/* the hand, exactly where the table keeps it */}
            <div className="flex-none pb-6">
                {!revealed && (
                    <div className="text-center text-white/85 font-orbitron text-xs sm:text-sm py-2">
                        Your turn — tap a card
                    </div>
                )}
                <div className="flex justify-center px-2">
                    <div className={`flex pt-6 pb-2 ${
                        revealed ? 'flex-wrap justify-center gap-1.5 gap-y-3' : '-space-x-5 sm:-space-x-4 md:-space-x-2'
                    }`}>
                        {hand9.map((c, i) => {
                            const bots = revealed && item.bot.card === c;
                            const mine = revealed && picked === c;
                            return (
                                // the raise lives on the wrapper so the dial and
                                // the pink bar ride up with the raised card
                                <div
                                    key={c}
                                    className={`relative transition-transform duration-200 ${mine ? '-translate-y-3' : ''}`}
                                    style={{ zIndex: i + 1 }}
                                >
                                    {revealed && (
                                        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
                                            <ValueDial frac={frac(c)} value={values[String(c)]} />
                                        </span>
                                    )}
                                    <PlayingCard
                                        card={toCard(c)} trump={SUITS[item.trump]} size="lg"
                                        onClick={!revealed ? () => play(c) : undefined}
                                        className={mine ? 'ring-2 ring-sky-400 border-sky-400' : ''}
                                    />
                                    {bots && (
                                        <span className="absolute -bottom-2 left-1 right-1 h-1.5 rounded-full z-50 pointer-events-none" style={{ background: '#ff2d95' }} />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </main>
    );
}
