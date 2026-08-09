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
    const [picked, setPicked] = useState<number | null>(null);
    const [revealed, setRevealed] = useState(false);
    const [grade, setGrade] = useState<string | null>(null);
    const [chips, setChips] = useState<string[]>([]);
    const [note, setNote] = useState('');
    const [saved, setSaved] = useState(0);

    useEffect(() => {
        fetch('/lab/firstcard_items.json').then(r => r.json()).then(setItems);
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
    const agree = revealed && picked === item.rc1.card;

    const submit = async () => {
        const payload = {
            game: 'firstcard', id: item.id, seed: item.seed, hand: item.hand,
            seat: item.seat, buyerRel: item.buyerRel,
            grader: grader || 'anon',
            human: { card: picked }, rc1: item.rc1,
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
        setPicked(null); setRevealed(false);
        setGrade(null); setChips([]); setNote('');
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
                    You lead trick one — tap your card
                </div>
                <div className="flex flex-nowrap items-end gap-1.5 mb-4 overflow-x-auto pt-5 pb-2">
                    {hand9.map(c => {
                        const mine = picked === c;
                        const bots = revealed && item.rc1.card === c;
                        const marks = revealed
                            ? `rounded-lg ${mine ? 'ring-2 ring-sky-400' : ''} ` +
                              `${bots ? 'outline outline-2 outline-offset-2 outline-pink-400' : ''}`
                            : 'rounded-lg';
                        return (
                            <div key={c} className={`relative flex-shrink-0 ${marks}`}>
                                <PlayingCard
                                    card={toCard(c)} trump={trumpSuit} size="sm"
                                    onClick={() => !revealed && setPicked(mine ? null : c)}
                                    selected={!revealed && mine}
                                />
                            </div>
                        );
                    })}
                </div>
                {revealed && (
                    <div className="text-xs text-white/60 -mt-1 mb-3">
                        <span className="text-sky-300 font-bold">blue</span> = your lead ·{' '}
                        <span className="text-pink-300 font-bold">pink</span> = the bot&apos;s
                        {agree && <span className="text-green-400 font-bold"> · same card!</span>}
                    </div>
                )}

                {!revealed ? (
                    <button
                        onClick={() => picked !== null && setRevealed(true)}
                        disabled={picked === null}
                        className={`w-full py-3 rounded-xl font-orbitron text-sm transition
                            ${picked !== null ? 'bg-sky-600 hover:bg-sky-500 text-white' : 'bg-white/10 text-white/30'}`}>
                        {picked !== null ? 'Lock it in — show me the bot' : 'Tap the card you would lead'}
                    </button>
                ) : (
                    <div className="rounded-xl border border-pink-400/40 bg-navy-950/60 p-4">
                        <div className="text-pink-300 font-orbitron text-sm font-bold mb-3">
                            {agree
                                ? 'Gen25-RC1 led the same card as you.'
                                : 'Gen25-RC1 led the pink-ringed card.'}
                        </div>
                        <div className="text-white/50 text-xs uppercase tracking-wider mb-1.5">Grade the bot&apos;s lead</div>
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
                )}
            </div>
        </main>
    );
}
