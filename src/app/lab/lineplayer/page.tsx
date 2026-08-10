'use client';

// LINE PLAYER LAB — play the whole hand; prove the line.
// You sit in the leader's chair on partner-bought hands from the corpus;
// the other three chairs are the live frozen bot (each move is real
// thinking via the local sidecar on :8124 — start it with
//   cd ml && ~/torch-env/bin/python -m alpharook.lineserve
// ). Skip dud hands freely. At hand end: your line's points vs what the
// bot's recorded line scored on the same deal. Completed lines are the
// continuation-included vision corpus.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PlayingCard from '@/components/ui/PlayingCard';
import { Card, SUITS } from '@/lib/game/types';
import { sortHand } from '@/lib/game/deck';

const SIDECAR = 'http://127.0.0.1:8124';

const toCard = (c: number): Card => ({ suit: SUITS[Math.floor(c / 10)], number: (c % 10) + 5 });
const toInt = (c: Card): number => SUITS.indexOf(c.suit) * 10 + (c.number - 5);

interface HandState {
    posId: string; seat: number; trump: number; bid: number; buyer: number;
    scores: [number, number]; cards: number[]; recPts: number | null;
}

const REL = ['ME', 'left', 'partner', 'right'];

export default function LinePlayerLab() {
    const router = useRouter();
    const [hand, setHand] = useState<HandState | null>(null);
    const [cards, setCards] = useState<number[]>([]);
    const [trick, setTrick] = useState<Array<[number, number]>>([]);
    const [lastTrick, setLastTrick] = useState<{ plays: Array<[number, number]>; winner: number; points: number } | null>(null);
    const [tricksDone, setTricksDone] = useState(0);
    const [thinking, setThinking] = useState(false);
    const [result, setResult] = useState<{ myPts: number; made: number; recPts: number | null; recMade: number | null } | null>(null);
    const [totals, setTotals] = useState({ hands: 0, mine: 0, bot: 0 });
    const [err, setErr] = useState('');
    const [grader, setGrader] = useState('');

    useEffect(() => {
        setGrader(localStorage.getItem('lab_grader') || '');
        setTotals(JSON.parse(localStorage.getItem('lab_line_totals')
            || '{"hands":0,"mine":0,"bot":0}'));
    }, []);

    const nextHand = async () => {
        setErr(''); setResult(null); setTrick([]); setLastTrick(null);
        setTricksDone(0); setThinking(true);
        try {
            const r = await fetch(`${SIDECAR}/next`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ grader }),
            }).then(x => x.json());
            if (r.error) { setErr(r.error); setHand(null); }
            else { setHand(r); setCards(r.cards); }
        } catch {
            setErr('Sidecar not running — start it with: cd ml && ~/torch-env/bin/python -m alpharook.lineserve');
        }
        setThinking(false);
    };

    const skip = async () => {
        if (!hand) return;
        await fetch(`${SIDECAR}/skip`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: hand.posId }),
        }).catch(() => {});
        nextHand();
    };

    const play = async (c: number) => {
        if (!hand || thinking || result) return;
        setThinking(true); setErr('');
        try {
            const r = await fetch(`${SIDECAR}/play`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ card: c }),
            }).then(x => x.json());
            if (r.error) { setErr(r.error); setThinking(false); return; }
            setCards(r.myCards);
            setTrick(r.trick ?? []);
            setLastTrick(r.lastTrick ?? null);
            setTricksDone(r.tricksDone ?? 0);
            if (r.over) {
                setResult(r);
                const t = {
                    hands: totals.hands + 1,
                    mine: totals.mine + r.myPts,
                    bot: totals.bot + (r.recPts ?? 0),
                };
                setTotals(t);
                localStorage.setItem('lab_line_totals', JSON.stringify(t));
            }
        } catch { setErr('lost the sidecar mid-hand'); }
        setThinking(false);
    };

    const trumpSuit = hand ? SUITS[hand.trump] : null;
    const sorted = hand
        ? sortHand(cards.map(toCard), trumpSuit).map(toInt) : [];
    const relOf = (s: number) => hand ? REL[(s - hand.seat + 4) % 4] : '';

    return (
        <main className="min-h-screen bg-gradient-to-b from-navy-900 to-navy-950 px-3 py-5">
            <div className="max-w-2xl mx-auto">
                <div className="flex items-center gap-3 mb-4">
                    <button onClick={() => router.push('/lab')} className="text-white/50 text-sm hover:text-white">← Lab</button>
                    <h1 className="font-orbitron text-yellow-400 text-lg font-bold">Line Player</h1>
                    <span className="text-white/40 text-xs ml-auto">
                        {totals.hands} hands · you {totals.mine} · bot {totals.bot}
                    </span>
                </div>

                {!hand && !thinking && (
                    <div className="text-center py-10">
                        <p className="text-white/70 text-sm mb-6 max-w-md mx-auto">
                            Partner bought it — you lead, and play the whole hand.
                            The other three chairs are the real bot, thinking live.
                            Skip any dud hand.
                        </p>
                        {err && <p className="text-red-400 text-xs mb-4">{err}</p>}
                        <button onClick={nextHand}
                            className="px-8 py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-orbitron text-sm">
                            Deal me in
                        </button>
                    </div>
                )}

                {hand && (
                    <>
                        <div className="flex items-center gap-3 mb-3 text-sm text-white/70">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold text-white
                                ${hand.trump === 0 ? 'bg-red-600' : hand.trump === 1 ? 'bg-yellow-500' : hand.trump === 2 ? 'bg-gray-900 border border-gray-500' : 'bg-green-600'}`}>
                                {trumpSuit} trump
                            </span>
                            <span>partner bought at <b className="text-white">{hand.bid}</b></span>
                            <span>score <b className="text-white">{hand.scores[0]}–{hand.scores[1]}</b></span>
                            <span className="ml-auto text-white/40 text-xs">trick {tricksDone + 1}/9</span>
                        </div>

                        {/* the table: current trick */}
                        <div className="rounded-xl border border-white/10 bg-navy-950/50 p-4 mb-3 min-h-[7rem]">
                            <div className="flex gap-3 items-end justify-center">
                                {trick.length === 0 && !result && (
                                    <span className="text-white/40 text-sm py-6">
                                        {thinking ? 'bots thinking…' : 'your lead'}
                                    </span>
                                )}
                                {trick.map(([s, c]) => (
                                    <div key={`${s}-${c}`} className="flex flex-col items-center gap-1">
                                        <PlayingCard card={toCard(c)} trump={trumpSuit} size="sm" />
                                        <span className={`text-[10px] ${s === hand.seat ? 'text-sky-300 font-bold' : 'text-white/50'}`}>
                                            {relOf(s)}
                                        </span>
                                    </div>
                                ))}
                                {thinking && trick.length > 0 && (
                                    <span className="text-white/40 text-xs pb-4">thinking…</span>
                                )}
                            </div>
                            {lastTrick && (
                                <div className="text-center text-[11px] text-white/40 mt-2">
                                    last trick: {relOf(lastTrick.winner)} took it
                                    {lastTrick.points ? ` (+${lastTrick.points} pts)` : ''}
                                </div>
                            )}
                        </div>

                        {/* my hand */}
                        {!result && (
                            <div className="flex flex-nowrap gap-1.5 mb-3 overflow-x-auto pt-4 pb-2">
                                {sorted.map(c => (
                                    <div key={c} className="flex-shrink-0">
                                        <PlayingCard
                                            card={toCard(c)} trump={trumpSuit} size="sm"
                                            onClick={() => play(c)}
                                            disabled={thinking}
                                        />
                                    </div>
                                ))}
                            </div>
                        )}
                        {err && <p className="text-red-400 text-xs mb-3">{err}</p>}

                        {!result ? (
                            <button onClick={skip} disabled={thinking}
                                className="text-white/40 text-xs border border-white/15 rounded-lg px-4 py-2 hover:text-white">
                                Skip this hand — nothing interesting here
                            </button>
                        ) : (
                            <div className="rounded-xl border border-sky-400/40 bg-navy-950/60 p-4">
                                <div className="font-orbitron text-sm font-bold mb-2 text-white">
                                    Your line: <span className="text-sky-300">{result.myPts} pts</span>
                                    {result.made ? ' — contract MADE' : ' — partner got SET'}
                                </div>
                                <div className="text-white/70 text-sm mb-3">
                                    The bot&apos;s line on this same deal: <b className="text-pink-300">{result.recPts} pts</b>
                                    {result.recMade ? ' (made)' : ' (set)'} —{' '}
                                    {result.recPts !== null && result.myPts > result.recPts
                                        ? <span className="text-green-400 font-bold">you +{result.myPts - result.recPts}</span>
                                        : result.recPts !== null && result.myPts < result.recPts
                                            ? <span className="text-red-400 font-bold">bot +{result.recPts - result.myPts}</span>
                                            : 'dead even'}
                                </div>
                                <button onClick={nextHand}
                                    className="w-full py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-orbitron text-sm">
                                    Next hand
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}
