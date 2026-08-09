'use client';

// WIDOWMAKER LAB — grade Gen25-RC1's burials, and beat them if you can.
// Positions come from public/lab/widow_items.json (milled from the belief
// soak corpus by ml/alpharook/lab_mill.py — every one is a real RC1 game,
// replayable by seed). Flow per hand: see your 13 (widow marked), pick
// trump + four to bury, lock it in, then RC1's choice is revealed for a
// 7-point grade with reason chips. Picks POST to /api/lab/widow which
// appends JSONL under ml/runs/lab/ for the fleet's replay scoring;
// localStorage keeps progress + a full backup so nothing is ever lost.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import PlayingCard from '@/components/ui/PlayingCard';
import { Card, Suit, SUITS } from '@/lib/game/types';

interface WidowItem {
    id: number; seed: number; hand: number; buyer: number;
    dealt: number[]; widow: number[]; bid: number;
    scores: [number, number]; dealerRel: number; leaderRel: number;
    rc1: { trump: number; godown: number[] };
}

const toCard = (c: number): Card => ({ suit: SUITS[Math.floor(c / 10)], number: (c % 10) + 5 });
const bySuitDesc = (a: number, b: number) =>
    Math.floor(a / 10) - Math.floor(b / 10) || (b % 10) - (a % 10);

const GRADES: Array<[string, string, string]> = [
    ['vg', 'Very good', 'bg-green-600'], ['g', 'Good', 'bg-green-700'],
    ['ok', 'Fine', 'bg-lime-700'], ['meh', 'Meh', 'bg-yellow-600'],
    ['bad', 'Bad', 'bg-orange-700'], ['vb', 'Very bad', 'bg-red-700'],
    ['ow', 'Obviously wrong', 'bg-red-600'],
];

// Riley's risk vocabulary — how humans actually think about a burial
const CHIPS = [
    'protects my weak suit', 'keeps trump control', 'buries stranded counters',
    'creates a void', 'wrong trump call', 'buried playable strength',
    'kept the wrong suit', 'fine, just different taste',
];

const REL_LABEL = ['me', 'left', 'partner', 'right'];

function TableMap({ dealerRel, leaderRel }: { dealerRel: number; leaderRel: number }) {
    // 3x3 mini table from the buyer's chair: partner top, left/right sides.
    const seatFor = (rel: number) => {
        const marks: string[] = [];
        if (dealerRel === rel) marks.push('D');
        if (leaderRel === rel) marks.push('X');
        return marks.join(' ');
    };
    const cell = (rel: number, label: string) => (
        <div className={`w-11 h-7 rounded border text-[10px] flex items-center justify-center gap-1
            ${leaderRel === rel ? 'border-yellow-400 text-yellow-300' : 'border-white/20 text-white/50'}`}>
            <span className="font-bold">{label}</span>
            <span>{seatFor(rel)}</span>
        </div>
    );
    return (
        <div className="grid grid-cols-3 gap-1 w-fit" title="D = dealer, X = leads trick 1">
            <div />{cell(2, '')}<div />
            {cell(1, '')}<div className="w-11 h-7" />{cell(3, '')}
            <div />{cell(0, 'ME')}<div />
        </div>
    );
}

export default function WidowMakerLab() {
    const router = useRouter();
    const [items, setItems] = useState<WidowItem[]>([]);
    const [idx, setIdx] = useState(0);
    const [grader, setGrader] = useState('');
    const [trump, setTrump] = useState<number | null>(null);
    const [picked, setPicked] = useState<number[]>([]);
    const [revealed, setRevealed] = useState(false);
    const [grade, setGrade] = useState<string | null>(null);
    const [chips, setChips] = useState<string[]>([]);
    const [note, setNote] = useState('');
    const [saved, setSaved] = useState(0);

    useEffect(() => {
        fetch('/lab/widow_items.json').then(r => r.json()).then(setItems);
        setGrader(localStorage.getItem('lab_grader') || '');
        setIdx(parseInt(localStorage.getItem('lab_widow_idx') || '0', 10));
        setSaved(parseInt(localStorage.getItem('lab_widow_saved') || '0', 10));
    }, []);

    const item = items[idx];
    const all13 = useMemo(() => item
        ? [...item.dealt, ...item.widow].sort(bySuitDesc) : [], [item]);
    const widowSet = useMemo(() => new Set(item?.widow ?? []), [item]);

    if (!item) {
        return <main className="min-h-screen bg-navy-950 flex items-center justify-center text-white/60">
            {items.length ? 'All done — that was the whole bank!' : 'Loading hands…'}
        </main>;
    }

    const trumpSuit: Suit | null = trump === null ? null : SUITS[trump];
    const togglePick = (c: number) => {
        if (revealed) return;
        setPicked(p => p.includes(c) ? p.filter(x => x !== c) : p.length < 4 ? [...p, c] : p);
    };
    const canLock = trump !== null && picked.length === 4;

    const submit = async () => {
        const payload = {
            game: 'widow', id: item.id, seed: item.seed, hand: item.hand,
            buyer: item.buyer, grader: grader || 'anon',
            human: { trump, godown: [...picked].sort((a, b) => a - b) },
            rc1: item.rc1, grade, chips, note, ts: Date.now(),
        };
        // belt and suspenders: localStorage first, then the API
        const key = 'lab_widow_picks';
        const backup = JSON.parse(localStorage.getItem(key) || '[]');
        backup.push(payload);
        localStorage.setItem(key, JSON.stringify(backup));
        try {
            await fetch('/api/lab/widow', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        } catch { /* localStorage still has it */ }
        localStorage.setItem('lab_widow_idx', String(idx + 1));
        localStorage.setItem('lab_widow_saved', String(saved + 1));
        setSaved(s => s + 1);
        setIdx(i => i + 1);
        setTrump(null); setPicked([]); setRevealed(false);
        setGrade(null); setChips([]); setNote('');
    };

    return (
        <main className="min-h-screen bg-gradient-to-b from-navy-900 to-navy-950 px-3 py-5">
            <div className="max-w-2xl mx-auto">
                <div className="flex items-center gap-3 mb-4">
                    <button onClick={() => router.push('/lab')} className="text-white/50 text-sm hover:text-white">← Lab</button>
                    <h1 className="font-orbitron text-yellow-400 text-lg font-bold">WidowMaker</h1>
                    <span className="text-white/40 text-xs ml-auto">
                        hand {idx + 1}/{items.length} · {saved} saved
                    </span>
                </div>

                <div className="flex items-center gap-2 mb-4">
                    <input
                        value={grader}
                        onChange={e => { setGrader(e.target.value); localStorage.setItem('lab_grader', e.target.value); }}
                        placeholder="Your name"
                        className="bg-navy-950/60 border border-white/15 rounded-lg px-3 py-1.5 text-sm text-white w-32"
                    />
                    <div className="text-white/70 text-sm">
                        You bought it at <b className="text-white">{item.bid}</b> ·
                        score <b className="text-white">{item.scores[0]}–{item.scores[1]}</b>
                    </div>
                    <div className="ml-auto"><TableMap dealerRel={item.dealerRel} leaderRel={item.leaderRel} /></div>
                </div>

                {/* step 1: pick trump */}
                <div className="mb-3">
                    <div className="text-white/50 text-xs uppercase tracking-wider mb-1.5">1 · Call trump</div>
                    <div className="flex gap-2">
                        {SUITS.map((s, i) => (
                            <button key={s} onClick={() => !revealed && setTrump(i)}
                                className={`px-4 py-1.5 rounded-full text-sm font-bold border-2 transition
                                    ${i === 0 ? 'bg-red-600' : i === 1 ? 'bg-yellow-500' : i === 2 ? 'bg-gray-900' : 'bg-green-600'} text-white
                                    ${trump === i ? 'border-sky-400 scale-105' : 'border-transparent opacity-70 hover:opacity-100'}`}>
                                {s}
                            </button>
                        ))}
                    </div>
                </div>

                {/* step 2: your 13, widow marked; tap 4 to bury */}
                <div className="mb-1 text-white/50 text-xs uppercase tracking-wider">
                    2 · Bury four <span className="normal-case">(dot = came from the widow)</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-4">
                    {all13.map(c => (
                        <div key={c} className="relative">
                            <PlayingCard
                                card={toCard(c)} trump={trumpSuit} size="md"
                                onClick={() => togglePick(c)}
                                selected={picked.includes(c)}
                            />
                            {widowSet.has(c) && (
                                <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-sky-400 border border-navy-950" />
                            )}
                        </div>
                    ))}
                </div>

                {!revealed ? (
                    <button
                        onClick={() => canLock && setRevealed(true)}
                        disabled={!canLock}
                        className={`w-full py-3 rounded-xl font-orbitron text-sm transition
                            ${canLock ? 'bg-sky-600 hover:bg-sky-500 text-white' : 'bg-white/10 text-white/30'}`}>
                        {canLock ? 'Lock it in — show me the bot' : `Pick trump and 4 cards (${picked.length}/4)`}
                    </button>
                ) : (
                    <div className="rounded-xl border border-pink-400/40 bg-navy-950/60 p-4">
                        <div className="text-pink-300 font-orbitron text-sm font-bold mb-2">
                            Gen25-RC1 called {SUITS[item.rc1.trump]}
                            {item.rc1.trump === trump ? ' (same as you)' : ` (you called ${trumpSuit})`}
                            {' '}and buried:
                        </div>
                        <div className="flex gap-1.5 mb-3">
                            {item.rc1.godown.map(c => (
                                <PlayingCard key={c} card={toCard(c)} trump={SUITS[item.rc1.trump]} size="sm" />
                            ))}
                        </div>
                        <div className="text-white/50 text-xs uppercase tracking-wider mb-1.5">Grade the bot&apos;s call</div>
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
                            placeholder="Optional note — what were you protecting?"
                            className="w-full bg-navy-900/80 border border-white/15 rounded-lg px-3 py-2 text-sm text-white mb-3"
                        />
                        <button onClick={submit} disabled={!grade}
                            className={`w-full py-3 rounded-xl font-orbitron text-sm
                                ${grade ? 'bg-sky-600 hover:bg-sky-500 text-white' : 'bg-white/10 text-white/30'}`}>
                            {grade ? 'Save & next hand' : 'Pick a grade first'}
                        </button>
                    </div>
                )}
            </div>
        </main>
    );
}
