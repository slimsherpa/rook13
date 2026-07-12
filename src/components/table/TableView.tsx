'use client';

// The live table. Mobile-first: you always sit at the bottom, partner across
// the top, play runs clockwise bottom -> left -> top -> right.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, GameAction, GameDoc, Seat, Team, sameCard, teamOf } from '@/lib/game/types';
import { bidTeamMaxPoints } from '@/lib/game/engine';
import { positionsFor } from './layout';
import { themeFor } from './theme';
import PlayerBadge from './PlayerBadge';
import TrickArea from './TrickArea';
import MyHand from './MyHand';
import ActionDock from './ActionDock';
import HandRecapModal from './HandRecapModal';
import ScoreSheetModal from './ScoreSheetModal';
import RedealOverlay from './RedealOverlay';
import GameOverOverlay from './GameOverOverlay';
import LastTrickPanel from './LastTrickPanel';
import PlayingCard from '@/components/ui/PlayingCard';
import ConfettiBurst from '@/components/ui/ConfettiBurst';
import { useWatchers } from '@/lib/hooks/useWatchers';
import { paced } from '@/lib/settings';
import SettingsModal from './SettingsModal';

interface TableViewProps {
    game: GameDoc;
    mySeat: Seat | null; // null = spectator
    act: (action: GameAction) => Promise<void>;
    actionError: string | null;
}

// both run through paced(): the game-speed setting scales the theater
const HAND_RECAP_DELAY_MS = 3000; // let the last trick sink in before the recap
const ANNOUNCE_MS = 4500;

export default function TableView({ game, mySeat, act, actionError }: TableViewProps) {
    const router = useRouter();
    const bottomSeat: Seat = mySeat ?? 'A1';
    const pos = positionsFor(bottomSeat);
    const [selectedGoDown, setSelectedGoDown] = useState<Card[]>([]);
    const [showScores, setShowScores] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showLastTrick, setShowLastTrick] = useState(false);
    const [goDownPeek, setGoDownPeek] = useState(false);
    const [showWatchers, setShowWatchers] = useState(false);
    const watchers = useWatchers(game.id, mySeat === null);
    const theme = themeFor(game.trump);

    // reset go-down selection whenever the phase moves on
    useEffect(() => {
        if (game.phase !== 'widow') setSelectedGoDown([]);
        if (game.phase !== 'playing') setGoDownPeek(false);
    }, [game.phase]);

    // hold the hand recap / game over screens back a beat so everyone can see
    // how the last trick landed
    const [recapReady, setRecapReady] = useState(false);
    useEffect(() => {
        if (game.phase === 'hand_done' || game.phase === 'game_over') {
            setRecapReady(false);
            const t = setTimeout(() => setRecapReady(true), paced(HAND_RECAP_DELAY_MS));
            return () => clearTimeout(t);
        }
        setRecapReady(false);
    }, [game.phase]);

    const teamLabel = (t: Team) =>
        t === 'A'
            ? `${game.seats.A1.name.split(' ')[0]} & ${game.seats.A2.name.split(' ')[0]}`
            : `${game.seats.B1.name.split(' ')[0]} & ${game.seats.B2.name.split(' ')[0]}`;

    // live "got set" / "maxxed" announcements, once each per hand — and they
    // know whose side you're on: heartbreak when it's your team, a party when
    // it's the other one, straight reporting for spectators
    const [announcement, setAnnouncement] = useState<{ text: string; emoji: string; tone: 'bad' | 'good' | 'info' } | null>(null);
    const announcedRef = useRef<Set<string>>(new Set());
    const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (announceTimer.current) clearTimeout(announceTimer.current); }, []);
    useEffect(() => {
        if (game.phase !== 'playing' || game.highBid === null || !game.bidWinner) return;
        const maxPts = bidTeamMaxPoints(game);
        if (maxPts === null) return;
        const bidTeam = teamOf(game.bidWinner);
        const myTeam: Team | null = mySeat ? teamOf(mySeat) : null;
        const mine = myTeam === bidTeam;
        let key: string | null = null;
        let next: typeof announcement = null;
        if (maxPts < game.highBid) {
            key = `set-${game.handNumber}`;
            next = mine
                ? { text: 'Oh no! We got SET!', emoji: '😭', tone: 'bad' }
                : myTeam
                    ? { text: `${teamLabel(bidTeam)} got SET!`, emoji: '🎉', tone: 'good' }
                    : { text: `${teamLabel(bidTeam)} got set!`, emoji: '💥', tone: 'info' };
        } else if (maxPts === game.highBid) {
            key = `maxxed-${game.handNumber}`;
            next = mine
                ? { text: "We're maxxed — every counter counts!", emoji: '😬', tone: 'bad' }
                : { text: `${teamLabel(bidTeam)} is maxxed!`, emoji: '👀', tone: 'info' };
        }
        if (!key || !next || announcedRef.current.has(key)) return;
        announcedRef.current.add(key);
        setAnnouncement(next);
        if (announceTimer.current) clearTimeout(announceTimer.current);
        announceTimer.current = setTimeout(() => setAnnouncement(null), paced(ANNOUNCE_MS));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [game]);

    // hand-points ticker: pulse the team chip that just captured points
    const [pointsFlash, setPointsFlash] = useState<Record<Team, boolean>>({ A: false, B: false });
    const prevPoints = useRef(game.pointsTaken);
    useEffect(() => {
        const gainA = game.pointsTaken.A > prevPoints.current.A;
        const gainB = game.pointsTaken.B > prevPoints.current.B;
        prevPoints.current = game.pointsTaken;
        if (!gainA && !gainB) return;
        setPointsFlash({ A: gainA, B: gainB });
        const t = setTimeout(() => setPointsFlash({ A: false, B: false }), 1000);
        return () => clearTimeout(t);
    }, [game.pointsTaken]);

    const toggleGoDown = (card: Card) => {
        setSelectedGoDown((prev) => {
            if (prev.some((c) => sameCard(c, card))) return prev.filter((c) => !sameCard(c, card));
            if (prev.length >= 4) return prev;
            return [...prev, card];
        });
    };

    const centerMessage = (() => {
        switch (game.phase) {
            case 'bidding':
                return game.highBid
                    ? `Bid ${game.highBid} · ${game.turn ? game.seats[game.turn].name.split(' ')[0] : ''} to act`
                    : 'Bidding opens at 65';
            case 'widow':
                return `${game.seats[game.bidWinner!].name.split(' ')[0]} took it at ${game.highBid}`;
            case 'trump':
                return 'Calling trump…';
            case 'dealing': {
                const dealerName = game.dealer === mySeat ? 'you' : game.seats[game.dealer!].name.split(' ')[0];
                return `Hand ${game.handNumber} · dealer: ${dealerName}`;
            }
            default:
                return null;
        }
    })();

    const showBids = game.phase === 'bidding' || game.phase === 'widow' || game.phase === 'trump';
    const iAmBidWinner = mySeat !== null && game.bidWinner === mySeat;
    const selectingGoDown = game.phase === 'widow' && iAmBidWinner;

    const badge = (seat: Seat, horizontal?: boolean) => (
        <PlayerBadge
            seat={seat}
            info={game.seats[seat]}
            isDealer={game.dealer === seat}
            isTurn={game.turn === seat && game.status === 'active'}
            bid={showBids ? game.bids[seat] : (game.bidWinner === seat && game.highBid ? game.highBid : undefined)}
            cardsLeft={game.phase === 'playing' ? game.hands[seat].length : undefined}
            horizontal={horizontal}
        />
    );

    return (
        <div
            className="h-dvh w-full flex flex-col overflow-hidden transition-colors duration-700"
            style={{ backgroundColor: theme.bg }}
        >
            {/* header — the background color already announces trump, and the
                bid lives on the bidder's badge, so this stays lean */}
            <header className="flex items-center justify-between px-3 py-2 bg-black/25 border-b border-white/10">
                <div className="flex items-center gap-2">
                    <button onClick={() => router.push('/')} className="text-white/70 hover:text-white flex items-center" title="Lobby">
                        <span className="material-symbols-outlined">arrow_back</span>
                    </button>
                    <span className="font-orbitron font-bold text-white text-sm sm:text-base">ROOK<span className="text-yellow-400">13</span></span>
                </div>
                <div className="flex items-center gap-2.5">
                    {watchers.length > 0 && (
                        <button
                            onClick={() => setShowWatchers(true)}
                            className="flex items-center gap-1 text-white/70 hover:text-white"
                            title={`${watchers.length} watching`}
                        >
                            <span className="material-symbols-outlined text-lg">visibility</span>
                            <span className="text-xs font-orbitron">{watchers.length}</span>
                        </button>
                    )}
                    <button onClick={() => setShowScores(true)} className="flex items-center gap-2 font-orbitron text-sm" title="Score sheet">
                        <span className="text-sky-300 font-bold">{game.scores.A}</span>
                        <span className="text-white/40 text-xs">·</span>
                        <span className="text-orange-300 font-bold">{game.scores.B}</span>
                        <span className="material-symbols-outlined text-white/70 text-lg">receipt_long</span>
                    </button>
                    <button onClick={() => setShowSettings(true)} className="flex items-center text-white/70 hover:text-white" title="Settings">
                        <span className="material-symbols-outlined text-lg">settings</span>
                    </button>
                </div>
            </header>

            {mySeat === null && (
                <div className="bg-navy-800/90 text-center text-white/90 text-xs font-orbitron py-1">
                    <span className="material-symbols-outlined text-sm align-middle mr-1">visibility</span>
                    Spectating
                </div>
            )}

            {/* table */}
            <main className="flex-1 relative flex items-center justify-center min-h-0">
                {/* badges sit above the felt so the compass pointer slides
                    underneath them, never over */}
                {/* partner (top) */}
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">{badge(pos.top)}</div>
                {/* left + right opponents */}
                <div className="absolute left-2 top-1/2 -translate-y-1/2 z-10">{badge(pos.left)}</div>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10">{badge(pos.right)}</div>

                <TrickArea game={game} bottomSeat={bottomSeat} trump={game.trump} message={centerMessage} />

                {/* hand-points ticker: the running count of captured points,
                    binging up on the team that just scooped a counter. Tapping
                    it opens the last-trick recap (once there's a trick to show). */}
                {game.phase === 'playing' && (() => {
                    const canReviewTrick = game.completedTricks.length > 0;
                    return (
                        <button
                            type="button"
                            onClick={() => canReviewTrick && setShowLastTrick(true)}
                            disabled={!canReviewTrick}
                            title={canReviewTrick ? 'Last trick' : undefined}
                            className={`absolute top-2 right-2 z-10 flex flex-col items-end gap-1 ${canReviewTrick ? 'cursor-pointer' : 'cursor-default'}`}
                        >
                            <span className="flex items-center gap-1 text-white/40 text-[9px] font-orbitron uppercase tracking-widest">
                                Hand pts
                                {canReviewTrick && <span className="material-symbols-outlined text-[13px] leading-none">history</span>}
                            </span>
                            <div className="flex gap-1.5">
                                <span className={`px-2 py-0.5 rounded-full bg-sky-700 text-white text-[11px] font-orbitron font-bold shadow ${pointsFlash.A ? 'animate-points-bing' : ''}`}>
                                    {game.pointsTaken.A}
                                </span>
                                <span className={`px-2 py-0.5 rounded-full bg-orange-700 text-white text-[11px] font-orbitron font-bold shadow ${pointsFlash.B ? 'animate-points-bing' : ''}`}>
                                    {game.pointsTaken.B}
                                </span>
                            </div>
                        </button>
                    );
                })()}

                {/* set / maxxed announcement — sized for drama */}
                {announcement && (
                    <>
                        {announcement.tone === 'good' && <ConfettiBurst count={36} spread={280} origin={{ x: 50, y: 30 }} />}
                        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 max-w-[92%] animate-announce-pop">
                            <div
                                className={`flex items-center gap-3 px-5 py-3 rounded-2xl border-2 text-center font-orbitron font-bold shadow-2xl bg-black/80 ${
                                    announcement.tone === 'bad'
                                        ? 'border-red-400/80 text-red-300 animate-announce-shake'
                                        : announcement.tone === 'good'
                                            ? 'border-yellow-400/80 text-yellow-300 shadow-[0_0_30px_rgba(234,179,8,0.35)]'
                                            : 'border-white/40 text-white/90'
                                }`}
                            >
                                <span className="text-3xl leading-none">{announcement.emoji}</span>
                                <span className="text-base sm:text-lg leading-snug">{announcement.text}</span>
                            </div>
                        </div>
                    </>
                )}

                {/* bottom-right corner: hand facts (your bid, who deals) above
                    the widow / go-down stacks */}
                <div className="absolute bottom-3 right-3 flex flex-col items-end gap-2">
                    {/* your bid, as a reminder of what you owe this hand — everyone
                        else reads the bid off the taker's badge */}
                    {iAmBidWinner && game.highBid !== null && game.phase !== 'bidding' && (
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-orbitron font-bold shadow bg-yellow-400 text-navy-950">
                            YOU · {game.highBid}
                        </span>
                    )}
                    {/* dealer reminder — your own badge is hidden on phones */}
                    {mySeat !== null && game.dealer === mySeat && game.status === 'active' && (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-yellow-400 text-navy-950 text-[11px] font-orbitron font-bold shadow">
                            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>playing_cards</span>
                            YOU DEAL
                        </span>
                    )}

                    {/* widow stack during bidding */}
                    {game.phase === 'bidding' && game.widow.length > 0 && (
                        <div className="flex flex-col items-center self-center">
                            <div className="flex -space-x-6">
                                {game.widow.map((_, i) => <PlayingCard key={i} faceDown size="xs" />)}
                            </div>
                            <span className="text-white/50 text-[10px] font-orbitron mt-1">WIDOW</span>
                        </div>
                    )}

                    {/* the taker's private go-down: tap to fan it out face-up,
                        tap again to stack it back face-down. Nobody else sees it.
                        (a div, not a button: face-up PlayingCards are buttons and
                        buttons must not nest) */}
                    {game.goDown.length > 0 && game.phase === 'playing' && iAmBidWinner && (
                        <div
                            role="button"
                            tabIndex={0}
                            className="flex flex-col items-center cursor-pointer"
                            onClick={() => setGoDownPeek((v) => !v)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setGoDownPeek((v) => !v); }}
                        >
                            <div className={`${goDownPeek ? 'flex gap-1' : 'flex -space-x-6'} pointer-events-none`}>
                                {game.goDown.map((c, i) => (
                                    <div key={i} className={goDownPeek ? 'animate-card-reveal' : ''}>
                                        <PlayingCard
                                            card={goDownPeek ? c : undefined}
                                            faceDown={!goDownPeek}
                                            trump={game.trump}
                                            size={goDownPeek ? 'sm' : 'xs'}
                                        />
                                    </div>
                                ))}
                            </div>
                            <span className="text-white/50 text-[10px] font-orbitron mt-1">GO-DOWN</span>
                        </div>
                    )}
                </div>

                {/* my badge floats above my hand on larger screens; on phones the
                    hand is identity enough. Spectators have no hand, so they get
                    the bottom player's badge front and center. */}
                {mySeat === null ? (
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2">{badge(pos.bottom)}</div>
                ) : (
                    <div className="absolute bottom-2 left-3 hidden sm:block">{badge(pos.bottom, true)}</div>
                )}
            </main>

            {/* dock + hand (spectators have neither) */}
            {mySeat && (
                <footer className="bg-black/25 border-t border-white/10 pb-[env(safe-area-inset-bottom)]">
                    {actionError && (
                        <div className="text-center text-red-300 text-xs font-orbitron pt-1">{actionError}</div>
                    )}
                    <ActionDock
                        game={game}
                        mySeat={mySeat}
                        selectedGoDown={selectedGoDown}
                        onAct={act}
                        onConfirmGoDown={() => {
                            if (mySeat && selectedGoDown.length === 4) {
                                act({ type: 'SELECT_GODOWN', seat: mySeat, cards: selectedGoDown });
                            }
                        }}
                    />
                    <MyHand
                        game={game}
                        seat={mySeat}
                        selecting={selectingGoDown}
                        selected={selectedGoDown}
                        onToggleSelect={toggleGoDown}
                        onPlay={(card) => act({ type: 'PLAY_CARD', seat: mySeat, card })}
                    />
                </footer>
            )}

            {/* overlays */}
            {showLastTrick && (
                <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowLastTrick(false)}>
                    <div onClick={(e) => e.stopPropagation()}>
                        <LastTrickPanel game={game} onClose={() => setShowLastTrick(false)} />
                    </div>
                </div>
            )}
            {game.phase === 'redeal' && <RedealOverlay game={game} mySeat={mySeat} onAct={act} />}
            {game.phase === 'hand_done' && recapReady && !showScores && (
                <HandRecapModal
                    game={game}
                    mySeat={mySeat}
                    onNextHand={() => act({ type: 'NEXT_HAND' })}
                    onShowScores={() => setShowScores(true)}
                />
            )}
            {game.phase === 'game_over' && recapReady && !showScores && (
                <GameOverOverlay game={game} mySeat={mySeat} onShowScores={() => setShowScores(true)} />
            )}
            {showScores && <ScoreSheetModal game={game} onClose={() => setShowScores(false)} />}
            {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
            {showWatchers && (
                <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowWatchers(false)}>
                    <div className="bg-navy-950 border border-white/15 rounded-2xl p-5 w-full max-w-xs" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2 text-white font-orbitron text-sm mb-3">
                            <span className="material-symbols-outlined text-lg">visibility</span>
                            Watching now · {watchers.length}
                        </div>
                        <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                            {watchers.map((w) => (
                                <div key={w.uid} className="flex items-center gap-3">
                                    {w.photoURL ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={w.photoURL} alt="" className="w-8 h-8 rounded-full border border-white/20" referrerPolicy="no-referrer" />
                                    ) : (
                                        <span className="w-8 h-8 rounded-full bg-navy-900 border border-white/20 flex items-center justify-center text-white text-xs font-orbitron">
                                            {w.name.charAt(0)}
                                        </span>
                                    )}
                                    <span className="text-white/90 text-sm truncate">{w.name}</span>
                                </div>
                            ))}
                        </div>
                        <button
                            onClick={() => setShowWatchers(false)}
                            className="mt-4 w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-orbitron text-sm"
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
