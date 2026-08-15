'use client';

// BEAT THE BOT — THE GO-DOWN. The real table's widow flow, one hand
// after another: your 13 on the felt, pick four, "Put Down", call trump
// (the background takes the trump color, exactly like the game), then
// the pre-searched Gen26+DayDream answer reveals instantly. Your four
// stay raised with the blue ring — exactly how a live go-down looks —
// and an assist-pink dot marks the cards the bot would have put down.

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

type Step = 'pick' | 'trump' | 'revealed';

export default function GoDownDrill() {
    const { user, loading } = useAuth();
    const router = useRouter();
    const [bank, setBank] = useState<Bank<GoDownItem> | null>(null);
    const [progress, setProgress] = useState<MiniGameProgress>(emptyProgress('godown'));
    const [ready, setReady] = useState(false);
    const [progReady, setProgReady] = useState(false);
    const [step, setStep] = useState<Step>('pick');
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
    const botSet = useMemo(
        () => new Set(step === 'revealed' ? item?.bot.godown ?? [] : []),
        [step, item],
    );

    if (loading || !user || !ready || !progReady) {
        return <LoadingPage title="Rook13" subtitle="Shuffling situations…" />;
    }

    const revealed = step === 'revealed';
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
        if (step !== 'pick') return;
        setPicked((p) => p.includes(c) ? p.filter((x) => x !== c) : p.length < 4 ? [...p, c] : p);
    };

    const confirmTrump = () => {
        if (trumpPick === null) return;
        const g = gradeGoDown(item, picked, trumpPick);
        setGrade(g);
        setStep('revealed');
        setProgress(recordAttempt(user.uid, progress, item.id, g));
    };
    const nextItem = () => {
        setPicked([]); setTrumpPick(null); setGrade(null); setStep('pick');
        setItemId(null);   // un-pin: the effect pins the next fresh one
    };

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
                        {step === 'pick'
                            ? 'What would the strongest bot in the family put in the Go Down?'
                            : 'And what would it call for trump?'}
                    </div>
                )}
            </div>

            {/* the dock + hand, exactly where the table keeps them */}
            <div className="flex-none pb-6">
                {step === 'pick' && (
                    <div className="flex items-center justify-center gap-3 py-1.5">
                        <span className="text-white/90 font-orbitron text-xs sm:text-sm">
                            Go-down: pick 4 cards ({picked.length}/4)
                        </span>
                        <button
                            onClick={() => picked.length === 4 && setStep('trump')}
                            disabled={picked.length !== 4}
                            className="px-5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white font-orbitron text-sm font-bold active:scale-95 transition"
                        >
                            Put Down
                        </button>
                    </div>
                )}
                {step === 'trump' && (
                    <>
                        <div className="flex items-center justify-center gap-2 py-1.5 flex-wrap px-2">
                            <span className="text-white/90 font-orbitron text-xs sm:text-sm mr-1">Trump:</span>
                            {SUITS.map((suit, i) => (
                                <button
                                    key={suit}
                                    onClick={() => setTrumpPick(i)}
                                    className={`px-4 py-2.5 rounded-lg text-white font-orbitron text-sm font-bold active:scale-95 transition ${suitButtonColors[suit]} ${trumpPick === i ? 'ring-4 ring-white' : trumpPick !== null ? 'opacity-50' : ''}`}
                                >
                                    {suit}
                                </button>
                            ))}
                        </div>
                        {trumpPick !== null && (
                            <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
                                <button
                                    onClick={confirmTrump}
                                    className={`pointer-events-auto px-8 py-5 rounded-3xl text-white font-orbitron shadow-2xl ring-4 ring-white/70 active:scale-95 transition animate-announce-pop ${suitButtonColors[SUITS[trumpPick]]}`}
                                >
                                    <span className="block text-2xl font-black leading-tight">{SUITS[trumpPick]} Trump</span>
                                    <span className="block text-sm font-bold mt-1 flex items-center justify-center gap-1">
                                        Lock it in — show the bot
                                        <span className="material-symbols-outlined text-lg">arrow_forward</span>
                                    </span>
                                </button>
                            </div>
                        )}
                    </>
                )}

                <div className="flex justify-center px-2">
                    <div className="flex pt-6 pb-2 flex-wrap justify-center max-w-md -space-x-5 sm:-space-x-4 md:-space-x-2 gap-y-2">
                        {all13.map((c, i) => {
                            const mine = picked.includes(c);
                            const bots = botSet.has(c);
                            return (
                                // on the reveal the raise moves to the wrapper so
                                // the bot's pink dot rides up with a raised card
                                <div
                                    key={c}
                                    className={`relative transition-transform duration-200 ${revealed && mine ? '-translate-y-3' : ''}`}
                                    style={{ zIndex: i + 1 }}
                                >
                                    {bots && (
                                        <span className="absolute -top-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
                                            <BotDot />
                                        </span>
                                    )}
                                    <PlayingCard
                                        card={toCard(c)} trump={trumpSuit} size="lg"
                                        onClick={step === 'pick' ? () => togglePick(c) : undefined}
                                        selected={!revealed && mine}
                                        className={revealed && mine ? 'ring-2 ring-sky-400 border-sky-400' : ''}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </main>
    );
}
