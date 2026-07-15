'use client';

// Full game review: every hand of a finished game, trick by trick, rebuilt
// from the action log. The screen the post-game arguments deserve.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { GameDoc, GameAction, Seat, teamOf } from '@/lib/game/types';
import { getGame, loadActionLog } from '@/lib/firebase/gameService';
import { HandReview, reconstructGame } from '@/lib/game/review';
import LoadingPage from '@/components/LoadingPage';
import { DealBreakdown, TrickByTrick } from '@/components/table/HandRecapModal';

export default function GameReview({ gameId }: { gameId: string }) {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [game, setGame] = useState<GameDoc | null>(null);
    const [hands, setHands] = useState<HandReview[] | null>(null);
    const [complete, setComplete] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [openHand, setOpenHand] = useState<number | null>(null);

    useEffect(() => {
        if (!user) return;
        (async () => {
            try {
                const g = await getGame(gameId);
                if (!g) { setError('Game not found'); return; }
                setGame(g);
                const log = await loadActionLog(gameId);
                const review = reconstructGame(g, log.map((e) => e.action as GameAction));
                setHands(review.hands);
                setComplete(review.complete);
                // a single-hand game might as well open expanded
                if (review.hands.length === 1) setOpenHand(0);
            } catch (e: any) {
                setError(e?.message || 'Could not load the game log');
            }
        })();
    }, [gameId, user]);

    if (authLoading || (user && !game && !error)) {
        return <LoadingPage title="Rook13" subtitle="Reading the archives…" />;
    }
    if (!user) {
        router.push(`/game?id=${gameId}`);
        return null;
    }
    if (error || !game) {
        return (
            <div className="min-h-dvh bg-navy-900 flex flex-col items-center justify-center gap-4 px-6 text-center">
                <p className="text-white font-orbitron max-w-sm">{error || 'Game not found'}</p>
                <button onClick={() => router.push('/')} className="px-6 py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-orbitron text-sm">
                    Back to Lobby
                </button>
            </div>
        );
    }

    const name = (seat: Seat) => game.seats[seat].name.split(' ')[0];
    const teamLabel = (t: 'A' | 'B') =>
        t === 'A' ? `${name('A1')} & ${name('A2')}` : `${name('B1')} & ${name('B2')}`;

    const handCard = (h: HandReview, idx: number) => {
        const open = openHand === idx;
        const s = h.summary;
        const bidTeam = teamOf(s.bidWinner);
        return (
            <div key={idx} className="rounded-2xl bg-navy-950/50 border border-white/15 overflow-hidden">
                <button
                    onClick={() => setOpenHand(open ? null : idx)}
                    className="w-full p-3.5 flex items-center gap-3 text-left"
                >
                    <div className="w-8 h-8 rounded-full bg-navy-950 border border-white/15 flex items-center justify-center text-white font-orbitron text-sm font-bold flex-shrink-0">
                        {s.handNumber}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-white font-orbitron text-sm">
                            {name(s.bidWinner)} bid {s.bid} · {s.trump}
                        </div>
                        <div className={`text-[11px] ${s.wentSet ? 'text-red-300' : 'text-white/60'}`}>
                            {s.wentSet ? `SET — took ${s.pointsTaken[bidTeam]}` : `made it with ${s.pointsTaken[bidTeam]}`}
                        </div>
                    </div>
                    <div className="text-right font-orbitron text-xs flex-shrink-0">
                        <div className={s.handScore.A < 0 ? 'text-red-400' : 'text-sky-300'}>
                            {s.handScore.A >= 0 ? '+' : ''}{s.handScore.A}
                        </div>
                        <div className={s.handScore.B < 0 ? 'text-red-400' : 'text-orange-300'}>
                            {s.handScore.B >= 0 ? '+' : ''}{s.handScore.B}
                        </div>
                    </div>
                    <span className="material-symbols-outlined text-white/50">{open ? 'expand_less' : 'expand_more'}</span>
                </button>

                {open && (
                    <div className="px-3.5 pb-4 border-t border-white/10 pt-3 space-y-4">
                        {/* the deal: hands, bids, the full auction, widow, go-down */}
                        <DealBreakdown
                            seats={game.seats}
                            h={{ ...s, dealtHands: s.dealtHands ?? h.dealtHands, dealtWidow: s.dealtWidow ?? h.dealtWidow }}
                            goDown={h.goDown}
                            tricksSource={h.tricks}
                            auction={h.bids.map((b) => ({ seat: b.seat as Seat, bid: b.bid }))}
                        />

                        {/* trick by trick, with the SET beat where it turned */}
                        <TrickByTrick
                            seats={game.seats}
                            tricks={h.tricks}
                            trump={h.trump}
                            h={{ ...s, dealtHands: s.dealtHands ?? h.dealtHands, dealtWidow: s.dealtWidow ?? h.dealtWidow }}
                            mySeat={game.seats.A1.uid === user?.uid ? 'A1'
                                : game.seats.B1.uid === user?.uid ? 'B1'
                                : game.seats.A2.uid === user?.uid ? 'A2'
                                : game.seats.B2.uid === user?.uid ? 'B2' : null}
                            compact
                        />
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="min-h-dvh bg-navy-900">
            <div className="max-w-md mx-auto px-4 py-5">
                <div className="flex items-center justify-between mb-5">
                    <button onClick={() => router.push('/')} className="text-white/70 hover:text-white flex items-center gap-1 font-orbitron text-sm">
                        <span className="material-symbols-outlined">arrow_back</span> Lobby
                    </button>
                    <span className="font-orbitron font-bold text-white">ROOK<span className="text-yellow-400">13</span></span>
                </div>

                {/* final result */}
                <div className="rounded-2xl bg-navy-950/60 border border-white/15 p-4 text-center mb-5">
                    <div className="text-white/60 text-xs font-orbitron uppercase tracking-widest">
                        {game.status === 'completed' ? 'Final Score' : 'Score So Far'}
                    </div>
                    <div className="flex items-center justify-center gap-5 mt-1 font-orbitron">
                        <div className="text-right">
                            <div className={`text-3xl font-bold ${game.winner === 'A' ? 'text-yellow-400' : 'text-sky-300'}`}>{game.scores.A}</div>
                            <div className="text-white/60 text-[11px] truncate max-w-[8rem]">{teamLabel('A')}</div>
                        </div>
                        <div className="text-white/40 text-sm">·</div>
                        <div className="text-left">
                            <div className={`text-3xl font-bold ${game.winner === 'B' ? 'text-yellow-400' : 'text-orange-300'}`}>{game.scores.B}</div>
                            <div className="text-white/60 text-[11px] truncate max-w-[8rem]">{teamLabel('B')}</div>
                        </div>
                    </div>
                    <div className="text-white/50 text-[11px] mt-2">
                        {new Date(game.createdAt).toLocaleDateString()} · table <span className="font-code text-[10px]">{game.joinCode}</span>
                    </div>
                </div>

                {!complete && (
                    <p className="text-yellow-300/80 text-xs font-orbitron text-center mb-3">
                        Some of this game&apos;s log couldn&apos;t be replayed — showing what we could recover.
                    </p>
                )}

                {hands === null ? (
                    <p className="text-center text-white/60 font-orbitron text-sm py-8">Rebuilding hands…</p>
                ) : hands.length === 0 ? (
                    <p className="text-center text-white/60 font-orbitron text-sm py-8">No finished hands in this game yet.</p>
                ) : (
                    <div className="space-y-2.5">{hands.map(handCard)}</div>
                )}
            </div>
        </div>
    );
}
