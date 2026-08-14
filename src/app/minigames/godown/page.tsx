'use client';

// BEAT THE BOT — THE GO-DOWN. You bought the bid: call trump, bury
// four, lock it in, and the pre-searched Gen26+DayDream answer is
// revealed instantly. Blue ring = your burial, pink ring = the bot's,
// double ring = agreement (the Laboratory's vocabulary).

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import PlayingCard from '@/components/ui/PlayingCard';
import { useAuth } from '@/lib/hooks/useAuth';
import { Suit, SUITS } from '@/lib/game/types';
import { sortHand } from '@/lib/game/deck';
import { AllDoneCard, FeedbackBanner, ScoreStrip, SUIT_BG, TableMap } from '@/components/minigames/shared';
import { Grade, gradeGoDown } from '@/lib/minigames/scoring';
import { getProgress, recordAttempt } from '@/lib/minigames/service';
import { Bank, GoDownItem, MiniGameProgress, emptyProgress, loadBank, toCard, toInt } from '@/lib/minigames/types';

export default function GoDownDrill() {
    const { user, loading } = useAuth();
    const router = useRouter();
    const [bank, setBank] = useState<Bank<GoDownItem> | null>(null);
    const [progress, setProgress] = useState<MiniGameProgress>(emptyProgress('godown'));
    const [ready, setReady] = useState(false);
    const [trump, setTrump] = useState<number | null>(null);
    const [picked, setPicked] = useState<number[]>([]);
    const [grade, setGrade] = useState<Grade | null>(null);

    useEffect(() => {
        if (!loading && !user) router.push('/');
    }, [user, loading, router]);

    useEffect(() => {
        if (!user) return;
        Promise.all([loadBank<GoDownItem>('godown'), getProgress(user.uid, 'godown')])
            .then(([b, p]) => { setBank(b); setProgress(p); setReady(true); })
            .catch(() => { setBank({ meta: { gen: '?', k: 0, updated: '', count: 0 }, items: [] }); setReady(true); });
    }, [user]);

    const doneSet = useMemo(() => new Set(progress.done), [progress.done]);
    const item = useMemo(
        () => bank?.items.find((it) => !doneSet.has(it.id)) ?? null,
        [bank, doneSet],
    );

    // production sort: trump first once called, re-sorts live
    const all13 = useMemo(() => {
        if (!item) return [] as number[];
        const cards = [...item.dealt, ...item.widow].map(toCard);
        return sortHand(cards, trump === null ? null : SUITS[trump]).map(toInt);
    }, [item, trump]);
    const widowSet = useMemo(() => new Set(item?.widow ?? []), [item]);
    const botSet = useMemo(
        () => new Set(grade ? item?.bot.godown ?? [] : []),
        [grade, item],
    );

    if (loading || !user || !ready) return null;

    const header = (
        <div className="flex items-center gap-3 mb-4">
            <button onClick={() => router.push('/minigames')} className="text-white/50 text-sm hover:text-white">← Mini Games</button>
            <h1 className="font-orbitron text-fuchsia-400 text-lg font-bold">The Go-Down</h1>
        </div>
    );

    if (!item) {
        return (
            <main className="min-h-dvh bg-gradient-to-b from-navy-900 to-navy-950 px-4 py-5">
                <div className="max-w-md mx-auto">
                    {header}
                    {bank && bank.items.length > 0
                        ? <AllDoneCard title="GO-DOWN MASTERED" />
                        : <div className="text-white/60 text-sm">No situations loaded yet — the first batch is still milling on Riley&apos;s Mac.</div>}
                </div>
            </main>
        );
    }

    const trumpSuit: Suit | null = trump === null ? null : SUITS[trump];
    const revealed = grade !== null;
    const togglePick = (c: number) => {
        if (revealed) return;
        setPicked((p) => p.includes(c) ? p.filter((x) => x !== c) : p.length < 4 ? [...p, c] : p);
    };
    const canLock = trump !== null && picked.length === 4;

    const lock = async () => {
        if (!canLock || revealed || trump === null) return;
        const g = gradeGoDown(item, picked, trump);
        setGrade(g);
        const next = await recordAttempt(user.uid, progress, item.id, g);
        setProgress(next);
    };
    const nextItem = () => { setTrump(null); setPicked([]); setGrade(null); };

    return (
        <main className="min-h-dvh bg-gradient-to-b from-navy-900 to-navy-950 px-4 py-5 pb-16">
            <div className="max-w-md mx-auto">
                {header}
                <ScoreStrip p={progress} total={bank?.items.length ?? 0} />

                <div className="flex items-center gap-3 mt-4 mb-2">
                    <div className="text-white/70 text-sm">
                        You bought it at <b className="text-white">{item.bid}</b>
                        <span className="text-white/40"> · </span>
                        score <b className="text-white">{item.scores[0]}–{item.scores[1]}</b>
                    </div>
                    <div className="ml-auto">
                        <TableMap mark="X" markRel={item.leaderRel} dealerRel={item.dealerRel} />
                    </div>
                </div>

                <div className="text-white/50 text-xs uppercase tracking-wider mb-1.5">1 · Call trump</div>
                <div className="flex gap-2 mb-4">
                    {SUITS.map((s, i) => (
                        <button key={s} onClick={() => !revealed && setTrump(i)}
                            className={`px-4 py-1.5 rounded-full text-sm font-bold border-2 transition text-white
                                ${SUIT_BG[i]}
                                ${trump === i ? 'border-sky-400 scale-105' : 'border-transparent opacity-70 hover:opacity-100'}`}>
                            {s}
                        </button>
                    ))}
                </div>

                <div className="text-white/50 text-xs uppercase tracking-wider mb-1.5">
                    2 · Bury four <span className="normal-case text-white/40">(dot = from the widow)</span>
                </div>
                <div className="flex flex-wrap justify-center gap-1.5 gap-y-3 mb-4 pt-4">
                    {all13.map((c) => {
                        const mine = picked.includes(c);
                        const bots = botSet.has(c);
                        const marks = revealed
                            ? `rounded-lg ${mine ? 'ring-2 ring-sky-400' : ''} ${bots ? 'outline outline-2 outline-offset-2 outline-pink-400' : ''}`
                            : 'rounded-lg';
                        return (
                            <div key={c} className={`relative ${marks}`}>
                                <PlayingCard
                                    card={toCard(c)} trump={trumpSuit} size="sm"
                                    onClick={() => togglePick(c)}
                                    selected={!revealed && mine}
                                />
                                {widowSet.has(c) && (
                                    <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-sky-400 border border-navy-950 z-10" />
                                )}
                            </div>
                        );
                    })}
                </div>

                {!revealed ? (
                    <button
                        onClick={lock}
                        disabled={!canLock}
                        className={`w-full py-3.5 rounded-xl font-orbitron text-sm font-bold active:scale-[0.98] transition
                            ${canLock ? 'bg-fuchsia-600 hover:bg-fuchsia-500 text-white' : 'bg-white/10 text-white/30'}`}>
                        {canLock ? 'LOCK IT IN' : `Pick trump and 4 cards (${picked.length}/4)`}
                    </button>
                ) : (
                    <>
                        <div className="text-xs text-white/60 mb-2">
                            <span className="text-sky-300 font-bold">blue ring</span> = your burial ·{' '}
                            <span className="text-pink-300 font-bold">pink ring</span> = mine ·
                            double = we agreed
                            {item.bot.trump !== trump && (
                                <> · I called <b className="text-white">{SUITS[item.bot.trump]}</b></>
                            )}
                        </div>
                        <FeedbackBanner grade={grade} k={item.k} />
                        <button
                            onClick={nextItem}
                            className="w-full mt-3 py-3.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-orbitron text-sm font-bold active:scale-[0.98] transition">
                            NEXT HAND →
                        </button>
                    </>
                )}
            </div>
        </main>
    );
}
