'use client';

// BEAT THE BOT — THE GO-DOWN. One screen, five picks: call trump and
// choose the four Go Down cards together, then LOCK IT IN and the
// pre-searched Gen26+DayDream answer reveals instantly (the background
// takes the trump color, exactly like the game). Trump pills follow the
// same suit order as the cards below; the 13 sit in two roomy rows
// (7 over 6) so every tap target is a whole card. On the reveal your
// four stay raised with the blue ring and assist-pink dots mark what
// the bot would have put down.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import PlayingCard from '@/components/ui/PlayingCard';
import LoadingPage from '@/components/LoadingPage';
import { useAuth } from '@/lib/hooks/useAuth';
import { Suit, SUITS } from '@/lib/game/types';
import { sortHand } from '@/lib/game/deck';
import { themeFor } from '@/components/table/theme';
import { AllDoneCard, BotDot, RevealCard, ScoreStrip, TableMap } from '@/components/minigames/shared';
import { explainGoDown } from '@/lib/minigames/explain';
import { Grade, gradeGoDown } from '@/lib/minigames/scoring';
import { getProgress, recordAttempt } from '@/lib/minigames/service';
import { Bank, GoDownItem, MiniGameProgress, emptyProgress, loadBank, toCard, toInt } from '@/lib/minigames/types';

// the table's trump-button colors (ActionDock vocabulary)
const suitButtonColors: Record<Suit, string> = {
    Red: 'bg-red-600 hover:bg-red-500',
    Yellow: 'bg-yellow-500 hover:bg-yellow-400 text-navy-950',
    Black: 'bg-gray-900 hover:bg-gray-800',
    Green: 'bg-green-600 hover:bg-green-500',
};

export default function GoDownDrill() {
    const { user, loading } = useAuth();
    const router = useRouter();
    const [bank, setBank] = useState<Bank<GoDownItem> | null>(null);
    const [progress, setProgress] = useState<MiniGameProgress>(emptyProgress('godown'));
    const [ready, setReady] = useState(false);
    const [progReady, setProgReady] = useState(false);
    const [picked, setPicked] = useState<number[]>([]);
    const [trumpPick, setTrumpPick] = useState<number | null>(null);
    const [grade, setGrade] = useState<Grade | null>(null);
    // the situation on the table is HELD until "next hand" — deriving it
    // from the done-set would advance it mid-reveal (grading marks the
    // item done, and the reveal must keep showing the graded hand)
    const [itemId, setItemId] = useState<number | null>(null);

    useEffect(() => {
        if (!loading && !user) router.push('/');
    }, [user, loading, router]);

    useEffect(() => {
        if (!user) return;
        // bank and progress load independently: a progress failure must
        // never block play (progress falls back to localStorage inside
        // the service anyway)
        loadBank<GoDownItem>('godown')
            .then(setBank)
            .catch(() => setBank({ meta: { gen: '?', k: 0, updated: '', count: 0 }, items: [] }))
            .finally(() => setReady(true));
        getProgress(user.uid, 'godown')
            .then(setProgress)
            .catch(() => {})
            .finally(() => setProgReady(true));
    }, [user]);

    const doneSet = useMemo(() => new Set(progress.done), [progress.done]);
    const item = useMemo(() => {
        if (!bank) return null;
        if (itemId !== null) return bank.items.find((it) => it.id === itemId) ?? null;
        return bank.items.find((it) => !doneSet.has(it.id)) ?? null;
    }, [bank, doneSet, itemId]);
    // pin the first fresh situation once BOTH loads settle (pinning off
    // the initial empty progress would re-deal an already-done hand)
    useEffect(() => {
        if (progReady && itemId === null && item) setItemId(item.id);
    }, [item, itemId, progReady]);

    // stable suit-sorted order (no trump yet) so cards never jump around
    const all13 = useMemo(() => {
        if (!item) return [] as number[];
        const cards = [...item.dealt, ...item.widow].map(toCard);
        return sortHand(cards, null).map(toInt);
    }, [item]);
    // trump pills follow the display: suits in card order first (longest
    // suit leads, same as the rows), then any suit not held
    const suitOrder = useMemo(() => {
        const order: number[] = [];
        for (const c of all13) {
            const s = Math.floor(c / 10);
            if (!order.includes(s)) order.push(s);
        }
        SUITS.forEach((_, s) => { if (!order.includes(s)) order.push(s); });
        return order;
    }, [all13]);
    const botSet = useMemo(
        () => new Set(grade ? item?.bot.godown ?? [] : []),
        [grade, item],
    );

    if (loading || !user || !ready || !progReady) {
        return <LoadingPage title="Rook13" subtitle="Shuffling situations…" />;
    }

    const revealed = grade !== null;
    const theme = themeFor(revealed && trumpPick !== null ? SUITS[trumpPick] : null);

    const header = (
        <div className="flex items-center gap-3 mb-3">
            <button onClick={() => router.push('/minigames')} className="text-white/70 text-sm hover:text-white flex items-center gap-1 font-orbitron">
                <span className="material-symbols-outlined text-lg">arrow_back</span>
                Mini Games
            </button>
            <h1 className="font-orbitron text-white text-base font-bold ml-auto">
                THE GO-<span className="text-yellow-400">DOWN</span>
            </h1>
        </div>
    );

    if (!item) {
        return (
            <main className="min-h-dvh px-4 py-5" style={{ background: theme.bg }}>
                <div className="max-w-md mx-auto">
                    {header}
                    {bank && bank.items.length > 0
                        ? <AllDoneCard title="GO-DOWN MASTERED" />
                        : <div className="text-white/70 text-sm text-center mt-10 font-orbitron">
                            No situations loaded — check back in a minute.
                        </div>}
                </div>
            </main>
        );
    }

    const trumpSuit: Suit | null = revealed && trumpPick !== null ? SUITS[trumpPick] : null;
    const togglePick = (c: number) => {
        if (revealed) return;
        setPicked((p) => p.includes(c) ? p.filter((x) => x !== c) : p.length < 4 ? [...p, c] : p);
    };
    const nPicked = picked.length + (trumpPick !== null ? 1 : 0);
    const canLock = trumpPick !== null && picked.length === 4;

    const lock = () => {
        if (!canLock || revealed || trumpPick === null) return;
        const g = gradeGoDown(item, picked, trumpPick);
        setGrade(g);
        setProgress(recordAttempt(user.uid, progress, item.id, g));
    };
    const nextItem = () => {
        setPicked([]); setTrumpPick(null); setGrade(null);
        setItemId(null);   // un-pin: the effect pins the next fresh one
    };

    const rows = [all13.slice(0, 7), all13.slice(7)];

    return (
        <main
            className="min-h-dvh flex flex-col transition-colors duration-500"
            style={{ background: theme.bg }}
        >
            <div className="w-full max-w-md mx-auto px-4 pt-4 flex-none">
                {header}
                <ScoreStrip p={progress} total={bank?.items.length ?? 0} />
                <div className="flex items-center gap-3 mt-3">
                    <div className="text-white/90 font-orbitron text-sm">
                        You bought it at <b className="text-yellow-300">{item.bid}</b>
                        <div className="text-white/60 text-[11px] font-sans mt-0.5">
                            score {item.scores[0]} to {item.scores[1]}
                        </div>
                    </div>
                    <div className="ml-auto">
                        <TableMap mark="X" markRel={item.leaderRel} dealerRel={item.dealerRel} />
                    </div>
                </div>
            </div>

            {/* the middle of the table: the reveal lands here */}
            <div className="flex-1 flex items-center justify-center px-4 py-3">
                {revealed && grade ? (
                    <RevealCard grade={grade} k={item.k} onNext={nextItem} nextLabel="NEXT HAND">
                        <div className="text-white/70 text-xs mt-2">
                            <span className="text-sky-300 font-bold">raised + blue</span> = your Go Down ·{' '}
                            <span className="font-bold" style={{ color: '#ff2d95' }}>pink dot</span> = what I&apos;d put down
                            {item.bot.trump !== trumpPick && (
                                <> · and I&apos;d call <b className="text-white">{SUITS[item.bot.trump]}</b> trump</>
                            )}
                        </div>
                        {grade.tier !== 'perfect' && (
                            <div className="text-white/60 text-xs mt-2 border-t border-white/10 pt-2">
                                {explainGoDown(item)}
                            </div>
                        )}
                    </RevealCard>
                ) : (
                    <div className="text-white/50 font-orbitron text-xs text-center">
                        Call trump and pick the four you&apos;d put in the Go Down —
                        then see the strongest bot in the family do it.
                    </div>
                )}
            </div>

            {/* the dock + hand: trump pills (in card order) over two roomy rows */}
            <div className="flex-none pb-6">
                <div className="flex items-center justify-center gap-2 py-1.5 flex-wrap px-2">
                    <span className="text-white/90 font-orbitron text-xs sm:text-sm mr-1">Trump:</span>
                    {suitOrder.map((i) => (
                        <div key={SUITS[i]} className="relative">
                            {revealed && item.bot.trump === i && (
                                <span className="absolute -top-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
                                    <BotDot />
                                </span>
                            )}
                            <button
                                onClick={() => !revealed && setTrumpPick(trumpPick === i ? null : i)}
                                className={`px-4 py-2.5 rounded-lg text-white font-orbitron text-sm font-bold active:scale-95 transition ${suitButtonColors[SUITS[i]]} ${trumpPick === i ? 'ring-4 ring-white' : trumpPick !== null || revealed ? 'opacity-50' : ''}`}
                            >
                                {SUITS[i]}
                            </button>
                        </div>
                    ))}
                </div>

                {!revealed && (
                    <div className="flex items-center justify-center gap-3 py-1.5">
                        <span className="text-white/90 font-orbitron text-xs sm:text-sm">
                            Trump + 4 cards ({nPicked}/5)
                        </span>
                        <button
                            onClick={lock}
                            disabled={!canLock}
                            className="px-5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white font-orbitron text-sm font-bold active:scale-95 transition"
                        >
                            Lock It In
                        </button>
                    </div>
                )}

                <div className="flex flex-col items-center gap-2 px-1 pt-4">
                    {rows.map((row, r) => (
                        <div key={r} className="flex justify-center gap-1 sm:gap-1.5">
                            {row.map((c) => {
                                const mine = picked.includes(c);
                                const bots = botSet.has(c);
                                return (
                                    // on the reveal the raise moves to the wrapper so
                                    // the bot's pink dot rides up with a raised card
                                    <div
                                        key={c}
                                        className={`relative transition-transform duration-200 ${revealed && mine ? '-translate-y-3' : ''}`}
                                    >
                                        {bots && (
                                            <span className="absolute -top-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
                                                <BotDot />
                                            </span>
                                        )}
                                        <PlayingCard
                                            card={toCard(c)} trump={trumpSuit} size="md"
                                            onClick={!revealed ? () => togglePick(c) : undefined}
                                            selected={!revealed && mine}
                                            className={revealed && mine ? 'ring-2 ring-sky-400 border-sky-400' : ''}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        </main>
    );
}
