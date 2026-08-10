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

const SEAT_TABS: Array<[number, string]> = [
    [2, 'Partner'], [0, 'I bought'], [1, 'On my left'], [3, 'On my right']];

export default function FirstCardLab() {
    const router = useRouter();
    const [items, setItems] = useState<FirstCardItem[]>([]);
    const [seat, setSeat] = useState(2);
    const [done, setDone] = useState<Set<number>>(new Set());
    const [grader, setGrader] = useState('');
    const [grade, setGrade] = useState<string | null>(null);
    const [chips, setChips] = useState<string[]>([]);
    const [note, setNote] = useState('');
    // optional per-card throttles: how much SHOULD each card be considered
    const [ranks, setRanks] = useState<Record<number, string>>({});
    // optional line: the card I'd play on trick 2 / trick 3, assuming I
    // keep winning — Riley's "there is an order these should be played"
    const [seq, setSeq] = useState<Record<number, number>>({});
    const [saved, setSaved] = useState(0);

    useEffect(() => {
        const SEAT_ORDER = [2, 0, 1, 3];
        fetch('/lab/firstcard_items.json').then(r => r.json()).then(raw => {
            const ordered = SEAT_ORDER.flatMap(rel =>
                (raw as FirstCardItem[]).filter(it => it.buyerRel === rel));
            setItems(ordered);
            // graded-id set; migrate from the old linear index if present
            const stored = localStorage.getItem('lab_fc_done');
            if (stored) {
                setDone(new Set(JSON.parse(stored)));
            } else {
                const oldIdx = parseInt(localStorage.getItem('lab_fc_idx') || '0', 10);
                const migrated = new Set(ordered.slice(0, oldIdx).map(it => it.id));
                setDone(migrated);
                localStorage.setItem('lab_fc_done',
                    JSON.stringify(Array.from(migrated)));
            }
        });
        setGrader(localStorage.getItem('lab_grader') || '');
        setSeat(parseInt(localStorage.getItem('lab_fc_seat') || '2', 10));
        setSaved(parseInt(localStorage.getItem('lab_fc_saved') || '0', 10));
    }, []);

    const seatItems = useMemo(() =>
        items.filter(it => it.buyerRel === seat), [items, seat]);
    const item = seatItems.find(it => !done.has(it.id));
    const seatDone = seatItems.filter(it => done.has(it.id)).length;
    const hand9 = useMemo(() => {
        if (!item) return [] as number[];
        return sortHand(item.cards.map(toCard), SUITS[item.trump]).map(toInt);
    }, [item]);

    const seatTabs = (
        <div className="flex gap-1.5 mb-4 flex-wrap">
            {SEAT_TABS.map(([rel, label]) => {
                const grp = items.filter(it => it.buyerRel === rel);
                const n = grp.filter(it => done.has(it.id)).length;
                return (
                    <button key={rel}
                        onClick={() => { setSeat(rel); localStorage.setItem('lab_fc_seat', String(rel)); }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition
                            ${seat === rel
                                ? 'border-yellow-400 text-yellow-300 bg-white/5'
                                : 'border-white/15 text-white/50 hover:text-white'}`}>
                        {label} <span className="font-normal opacity-70">{n}/{grp.length}</span>
                    </button>
                );
            })}
        </div>
    );

    if (!item) {
        return <main className="min-h-screen bg-gradient-to-b from-navy-900 to-navy-950 px-3 py-5">
            <div className="max-w-2xl mx-auto">
                <div className="flex items-center gap-3 mb-4">
                    <button onClick={() => router.push('/lab')} className="text-white/50 text-sm hover:text-white">← Lab</button>
                    <h1 className="font-orbitron text-yellow-400 text-lg font-bold">First Card Player</h1>
                </div>
                {items.length ? seatTabs : null}
                <div className="text-white/60 text-sm">
                    {items.length ? 'This seat is fully graded — pick another above.' : 'Loading leads…'}
                </div>
            </div>
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

    const setRank = (c: number, v: string) => {
        setRanks(r => {
            const out = { ...r };
            if (out[c] === v) delete out[c]; else out[c] = v;
            return out;
        });
    };
    const setSeqN = (n: number, c: number) => {
        setSeq(sq => {
            const out = { ...sq };
            if (out[n] === c) { delete out[n]; return out; }
            out[n] = c;
            return out;
        });
    };

    const submit = async () => {
        const payload = {
            game: 'firstcard', id: item.id, seed: item.seed, hand: item.hand,
            seat: item.seat, buyerRel: item.buyerRel,
            grader: grader || 'anon',
            rc1: item.rc1, ranks, seq,
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
        const nd = new Set(done); nd.add(item.id);
        setDone(nd);
        localStorage.setItem('lab_fc_done', JSON.stringify(Array.from(nd)));
        localStorage.setItem('lab_fc_saved', String(saved + 1));
        setSaved(s => s + 1);
        setGrade(null); setChips([]); setNote(''); setRanks({}); setSeq({});
    };

    return (
        <main className="min-h-screen bg-gradient-to-b from-navy-900 to-navy-950 px-3 py-5">
            <div className="max-w-2xl mx-auto">
                <div className="flex items-center gap-3 mb-4">
                    <button onClick={() => router.push('/lab')} className="text-white/50 text-sm hover:text-white">← Lab</button>
                    <h1 className="font-orbitron text-yellow-400 text-lg font-bold">First Card Player</h1>
                    <span className="text-white/40 text-xs ml-auto">
                        this seat {seatDone + 1}/{seatItems.length} · {saved} saved total
                    </span>
                </div>
                {seatTabs}

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
                <div className="mb-2 text-[11px] text-white/40 leading-relaxed">
                    Optional, per card: rate it as a FIRST lead —
                    <span className="text-green-400 font-bold"> ★ top pick</span> ·
                    <span className="text-lime-300 font-bold"> ✓ fine</span> ·
                    <span className="text-red-400 font-bold"> ✕ never</span>.
                    Below the line: your LINE — tap <b className="text-white/70">2</b> on
                    the card you&apos;d play next (if you win), <b className="text-white/70">3</b> after that.
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
                                <div className="flex flex-col gap-0.5">
                                    {([['top', '★', 'border-green-400 text-green-400 bg-white/5'],
                                       ['ok', '✓', 'border-lime-300 text-lime-300 bg-white/5'],
                                       ['no', '✕', 'border-red-400 text-red-400 bg-white/5']] as const).map(([v, glyph, on]) => (
                                        <button key={v}
                                            onClick={() => setRank(c, v)}
                                            className={`w-7 h-5 rounded border text-[11px] font-bold transition
                                                ${ranks[c] === v ? on
                                                    : 'border-white/10 text-white/20 hover:border-white/40 hover:text-white/50'}`}
                                        >{glyph}</button>
                                    ))}
                                    <div className="h-px bg-white/15 my-0.5" />
                                    {[2, 3].map(n => (
                                        <button key={n}
                                            onClick={() => setSeqN(n, c)}
                                            className={`w-7 h-5 rounded border text-[11px] font-bold transition
                                                ${seq[n] === c
                                                    ? 'border-sky-400 text-sky-300 bg-white/5'
                                                    : 'border-white/10 text-white/20 hover:border-white/40 hover:text-white/50'}`}
                                        >{n}</button>
                                    ))}
                                </div>
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
