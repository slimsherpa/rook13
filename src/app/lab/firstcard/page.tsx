'use client';

// FIRST CARD PLAYER LAB — the biggest card of the hand, all four seats.
// 400 real RC1 opening leads from the soak corpus, 100 per buyer seat
// (yours / left / partner / right). Trump is already called; you ARE the
// leader. Tap the card you'd lead, lock it, then RC1's actual lead is
// revealed for the 7-point grade. Same JSONL sink pattern as WidowMaker
// (ml/runs/lab/firstcard_picks.jsonl) for the replay scoreboard:
// human leads trick 1, the frozen bot plays everything after.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import PlayingCard from '@/components/ui/PlayingCard';
import { Card, Suit, SUITS } from '@/lib/game/types';
import { sortHand } from '@/lib/game/deck';

interface FirstCardItem {
    id: number; seed: number; hand: number; seat: number;
    cards: number[]; trump: number; bid: number;
    buyerRel: number; declarer: number; scores: [number, number];
    rc1: { card: number };
    temps?: Record<string, number> | null;
}

const toCard = (c: number): Card => ({ suit: SUITS[Math.floor(c / 10)], number: (c % 10) + 5 });
const toInt = (c: Card): number => SUITS.indexOf(c.suit) * 10 + (c.number - 5);

const GRADES: Array<[string, string, string]> = [
    ['vg', 'Very good', 'bg-green-600'], ['g', 'Good', 'bg-green-700'],
    ['ok', 'Fine', 'bg-lime-700'], ['meh', 'Meh', 'bg-yellow-600'],
    ['bad', 'Bad', 'bg-orange-700'], ['vb', 'Very bad', 'bg-red-700'],
    ['ow', 'Obviously wrong', 'bg-red-600'],
];

// lead-specific vocabulary (Riley's critique language)
const CHIPS = [
    'shows partner my boss', 'safe exit', 'right suit, wrong card',
    'leads into the buyer', 'wasted my count', 'gives up trump control',
    'too hypothetical', 'fine, just different taste',
];

const BUYER_LABEL = [
    'You bought it — you lead into your own contract',
    'Buyer is on your LEFT (plays right after you)',
    'Your PARTNER bought it — lead into their contract',
    'Buyer is on your RIGHT (plays last behind you)',
];

function BuyerMap({ rel }: { rel: number }) {
    const cell = (r: number, label: string) => (
        <div className={`w-11 h-7 rounded border text-[10px] flex items-center justify-center gap-1
            ${rel === r ? 'border-yellow-400 text-yellow-300 font-bold' : 'border-white/20 text-white/50'}`}>
            {label}{rel === r ? ' X' : ''}
        </div>
    );
    return (
        <div className="grid grid-cols-3 gap-1 w-fit" title="X = bought the contract; you lead">
            <div />{cell(2, '')}<div />
            {cell(1, '')}<div className="w-11 h-7" />{cell(3, '')}
            <div />{cell(0, 'ME')}<div />
        </div>
    );
}

export default function FirstCardLab() {
    const router = useRouter();
    const [items, setItems] = useState<FirstCardItem[]>([]);
    const [idx, setIdx] = useState(0);
    const [grader, setGrader] = useState('');
    const [grade, setGrade] = useState<string | null>(null);
    const [chips, setChips] = useState<string[]>([]);
    const [note, setNote] = useState('');
    // optional per-card throttles: how much SHOULD each card be considered
    const [ranks, setRanks] = useState<Record<number, string>>({});
    const [saved, setSaved] = useState(0);

    useEffect(() => {
        // Riley's ordering: partner-buys first, buyer-on-right LAST (the
        // most subjective seat to judge); stable within each group
        const SEAT_ORDER = [2, 0, 1, 3];
        fetch('/lab/firstcard_items.json').then(r => r.json()).then(all =>
            setItems(SEAT_ORDER.flatMap(rel =>
                (all as FirstCardItem[]).filter(it => it.buyerRel === rel))));
        setGrader(localStorage.getItem('lab_grader') || '');
        setIdx(parseInt(localStorage.getItem('lab_fc_idx') || '0', 10));
        setSaved(parseInt(localStorage.getItem('lab_fc_saved') || '0', 10));
    }, []);

    const item = items[idx];
    const hand9 = useMemo(() => {
        if (!item) return [] as number[];
        return sortHand(item.cards.map(toCard), SUITS[item.trump]).map(toInt);
    }, [item]);

    if (!item) {
        return <main className="min-h-screen bg-navy-950 flex items-center justify-center text-white/60">
            {items.length ? 'All done — that was the whole bank!' : 'Loading leads…'}
        </main>;
    }

    const trumpSuit = SUITS[item.trump];
    const temps = item.temps ?? null;
    const tvals = temps ? Object.values(temps) : [];
    const tmin = tvals.length ? Math.min(...tvals) : 0;
    const tmax = tvals.length ? Math.max(...tvals) : 0;
    const frac = (c: number) => {
        if (!temps || tmax === tmin) return 0;
        const t = temps[String(c)];
        return t === undefined ? 0 : Math.max(0.05, (t - tmin) / (tmax - tmin));
    };

    const RANK_CYCLE = [null, 'top', 'ok', 'no'] as const;
    const cycleRank = (c: number) => {
        setRanks(r => {
            const cur = (r[c] ?? null) as typeof RANK_CYCLE[number];
            const next = RANK_CYCLE[(RANK_CYCLE.indexOf(cur) + 1) % RANK_CYCLE.length];
            const out = { ...r };
            if (next === null) delete out[c]; else out[c] = next;
            return out;
        });
    };

    const submit = async () => {
        const payload = {
            game: 'firstcard', id: item.id, seed: item.seed, hand: item.hand,
            seat: item.seat, buyerRel: item.buyerRel,
            grader: grader || 'anon',
            rc1: item.rc1, ranks,
            grade, chips, note, ts: Date.now(),
        };
        const key = 'lab_fc_picks';
        const backup = JSON.parse(localStorage.getItem(key) || '[]');
        backup.push(payload);
        localStorage.setItem(key, JSON.stringify(backup));
        try {
            await fetch('/api/lab/firstcard', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        } catch { /* localStorage still has it */ }
        localStorage.setItem('lab_fc_idx', String(idx + 1));
        localStorage.setItem('lab_fc_saved', String(saved + 1));
        setSaved(s => s + 1);
        setIdx(i => i + 1);
        setGrade(null); setChips([]); setNote(''); setRanks({});
    };

    return (
        <main className="min-h-screen bg-gradient-to-b from-navy-900 to-navy-950 px-3 py-5">
            <div className="max-w-2xl mx-auto">
                <div className="flex items-center gap-3 mb-4">
                    <button onClick={() => router.push('/lab')} className="text-white/50 text-sm hover:text-white">← Lab</button>
                    <h1 className="font-orbitron text-yellow-400 text-lg font-bold">First Card Player</h1>
                    <span className="text-white/40 text-xs ml-auto">
                        lead {idx + 1}/{items.length} · {saved} saved
                    </span>
                </div>

                <div className="flex items-center gap-3 mb-2">
                    <input
                        value={grader}
                        onChange={e => { setGrader(e.target.value); localStorage.setItem('lab_grader', e.target.value); }}
                        placeholder="Your name"
                        className="bg-navy-950/60 border border-white/15 rounded-lg px-3 py-1.5 text-sm text-white w-32"
                    />
                    <div className="text-white/70 text-sm">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold text-white mr-2
                            ${item.trump === 0 ? 'bg-red-600' : item.trump === 1 ? 'bg-yellow-500' : item.trump === 2 ? 'bg-gray-900 border border-gray-500' : 'bg-green-600'}`}>
                            {trumpSuit} trump
                        </span>
                        bid <b className="text-white">{item.bid}</b> ·
                        score <b className="text-white">{item.scores[0]}–{item.scores[1]}</b>
                    </div>
                    <div className="ml-auto"><BuyerMap rel={item.buyerRel} /></div>
                </div>
                <div className="text-yellow-300/90 text-sm mb-3">{BUYER_LABEL[item.buyerRel]}</div>

                <div className="mb-1 text-white/50 text-xs uppercase tracking-wider">
                    The leader&apos;s hand — <span className="text-pink-300">pink ring</span> = the
                    card RC1 led · the fill circle is how hot its search ran on each card
                </div>
                <div className="mb-2 text-[11px] text-white/40">
                    Optional: tap the little box under a card to rate it yourself —
                    <span className="text-green-400 font-bold"> ★ top pick</span> ·
                    <span className="text-lime-300 font-bold"> ✓ fine contender</span> ·
                    <span className="text-red-400 font-bold"> ✕ shouldn&apos;t consider</span>
                </div>
                <div className="flex flex-nowrap items-start gap-1.5 mb-4 overflow-x-auto pt-1 pb-2">
                    {hand9.map(c => {
                        const bots = item.rc1.card === c;
                        return (
                            <div key={c} className="relative flex-shrink-0 flex flex-col items-center gap-1">
                                <div className={bots ? 'rounded-lg outline outline-2 outline-offset-2 outline-pink-400' : 'rounded-lg'}>
                                    <PlayingCard card={toCard(c)} trump={trumpSuit} size="sm" />
                                </div>
                                <span
                                    className="w-4 h-4 rounded-full"
                                    title={temps ? `search value ${temps[String(c)]}` : 'no temps yet'}
                                    style={{
                                        background: temps
                                            ? `conic-gradient(#e85d8a ${(frac(c) * 360).toFixed(0)}deg, rgba(255,255,255,.15) 0)`
                                            : 'rgba(255,255,255,.08)',
                                    }}
                                />
                                <button
                                    onClick={() => cycleRank(c)}
                                    className={`w-7 h-6 rounded border text-xs font-bold transition
                                        ${ranks[c] === 'top' ? 'border-green-400 text-green-400'
                                        : ranks[c] === 'ok' ? 'border-lime-300 text-lime-300'
                                        : ranks[c] === 'no' ? 'border-red-400 text-red-400'
                                        : 'border-white/15 text-white/25 hover:border-white/40'}`}
                                    title="tap to cycle: top / fine / never"
                                >
                                    {ranks[c] === 'top' ? '★' : ranks[c] === 'ok' ? '✓'
                                        : ranks[c] === 'no' ? '✕' : '·'}
                                </button>
                            </div>
                        );
                    })}
                </div>

                    <div className="rounded-xl border border-pink-400/40 bg-navy-950/60 p-4">
                        <div className="text-white/50 text-xs uppercase tracking-wider mb-1.5">
                            Grade the bot&apos;s lead &amp; its temperature spread</div>
                        <div className="flex flex-wrap gap-1.5 mb-3">
                            {GRADES.map(([k, label, color]) => (
                                <button key={k} onClick={() => setGrade(grade === k ? null : k)}
                                    className={`px-3 py-1 rounded-lg text-xs border transition
                                        ${grade === k ? `${color} text-white border-transparent` : 'border-white/20 text-white/60 hover:text-white'}`}>
                                    {label}
                                </button>
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-1.5 mb-3">
                            {CHIPS.map(ch => (
                                <button key={ch}
                                    onClick={() => setChips(cs => cs.includes(ch) ? cs.filter(x => x !== ch) : [...cs, ch])}
                                    className={`px-2.5 py-1 rounded-full text-[11px] border transition
                                        ${chips.includes(ch) ? 'border-yellow-400 text-yellow-300' : 'border-white/15 text-white/50 hover:text-white'}`}>
                                    {ch}
                                </button>
                            ))}
                        </div>
                        <input
                            value={note} onChange={e => setNote(e.target.value)}
                            placeholder="Optional note — why that card?"
                            className="w-full bg-navy-900/80 border border-white/15 rounded-lg px-3 py-2 text-sm text-white mb-3"
                        />
                        <button onClick={submit} disabled={!grade}
                            className={`w-full py-3 rounded-xl font-orbitron text-sm
                                ${grade ? 'bg-sky-600 hover:bg-sky-500 text-white' : 'bg-white/10 text-white/30'}`}>
                            {grade ? 'Save & next lead' : 'Pick a grade first'}
                        </button>
                    </div>
            </div>
        </main>
    );
}
