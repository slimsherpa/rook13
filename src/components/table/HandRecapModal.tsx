'use client';

// Shown when a hand finishes (phase 'hand_done'). Crisp, top to bottom:
// the verdict, one scoreboard (hand score → updated game score), the deal
// itself — every hand as dealt, each seat's bid with the winner lit up, the
// widow and the go-down — then the trick-by-trick review the family loved
// in v1. The Next Hand button stays pinned at the bottom no matter how far
// you scroll. Any player can start the next hand.

import { Card, GameDoc, Seat, Suit, Team, HandSummary, TrickRecord, teamOf, nextSeat, getCardPoints } from '@/lib/game/types';
import { rainbowNumbersFor } from '@/lib/game/stats';
import { setSealedTrick } from '@/lib/game/setPoint';
import { sortHand } from '@/lib/game/deck';
import PlayingCard from '@/components/ui/PlayingCard';
import ConfettiBurst from '@/components/ui/ConfettiBurst';

interface HandRecapModalProps {
    game: GameDoc;
    mySeat: Seat | null;
    onNextHand: () => void;
    onShowScores: () => void;
}

interface TrophyMoment {
    emoji: string;
    text: string;
    /** big ones get the confetti */
    big: boolean;
}

/** The brag-worthy things that happened to YOU this hand — mirrors the
 *  Trophy Case stats so the celebration lands the moment you earn it. */
const trophyMoments = (h: HandSummary, mySeat: Seat | null): TrophyMoment[] => {
    if (!mySeat) return [];
    const out: TrophyMoment[] = [];
    const myTeam = teamOf(mySeat);
    const dealt = h.dealtHands?.[mySeat];
    if (dealt && dealt.length > 0) {
        const pts = dealt.reduce((sum, c) => sum + getCardPoints(c), 0);
        // same rule as the Trophy Case: the widow pickup counts for the taker
        for (const num of rainbowNumbersFor(h, mySeat)) {
            out.push({ emoji: '🌈', text: `Rainbow ${num} — you held all four!`, big: true });
        }
        if (pts >= 40) out.push({ emoji: '🔥', text: `${pts} count dealt to you!`, big: true });
        else if (pts === 0) out.push({ emoji: '🃏', text: 'Zero count — a hand full of air!', big: false });
        const bySuit = new Map<string, number>();
        for (const c of dealt) bySuit.set(c.suit, (bySuit.get(c.suit) ?? 0) + 1);
        for (const [suit, n] of Array.from(bySuit.entries())) {
            if (n >= 7) out.push({ emoji: '📏', text: `${n} ${suit} in one deal!`, big: n >= 8 });
        }
    }
    if (h.bidWinner === mySeat && !h.wentSet && h.bid >= 100) {
        out.push({ emoji: '🏆', text: `Bid ${h.bid} and MADE IT!`, big: true });
    }
    if (teamOf(h.bidWinner) !== myTeam && h.wentSet) {
        out.push({ emoji: '🛡️', text: `You set them! That's −${h.bid} they'll remember.`, big: false });
    }
    if (h.tricksWon[myTeam] === 9) {
        out.push({ emoji: '🧹', text: 'Swept all nine tricks!', big: true });
    }
    return out;
};

type Seats = GameDoc['seats'];

const firstName = (seats: Seats, seat: Seat) => seats[seat].name.split(' ')[0];

/** Seats in auction order: dealer's left first, clockwise. */
const seatsFromDealer = (dealer: Seat): Seat[] => {
    const first = nextSeat(dealer);
    return [first, nextSeat(first), nextSeat(nextSeat(first)), nextSeat(nextSeat(nextSeat(first)))];
};

const bidChipClass = (kind: 'win' | 'live' | 'pass') =>
    `px-1.5 py-px rounded-md text-[10px] font-orbitron font-bold flex-shrink-0 ${
        kind === 'win'
            ? 'bg-yellow-400 text-navy-950 shadow-[0_0_8px_rgba(234,179,8,0.45)]'
            : kind === 'pass' ? 'bg-white/10 text-white/50' : 'bg-sky-800 text-sky-200'
    }`;

/** The deal AND the auction as one section, laid out like Riley's sketch:
 *  each seat in bidding order (first bidder on top, the dealer wearing a
 *  DEALER tag at the bottom), the hand they were dealt, and their whole run
 *  of bids underneath their cards. The seat that took it expands right
 *  there — the widow, the nine they kept, and the go-down — because that's
 *  where those cards belong. Shared by the live recap and /review. */
export function DealBreakdown({ seats, h, goDown, auction }: {
    seats: Seats;
    h: HandSummary;
    goDown: Card[];
    /** every bid in order (overrides h.bidLog when the caller has its own) */
    auction?: { seat: Seat; bid: number | 'pass' }[];
}) {
    if (!h.dealtHands) return null;
    const bidLog = auction ?? h.bidLog ?? [];

    // each seat's bids in the order they were made; falls back to the single
    // final bid for older games that didn't log the blow-by-blow
    const bidsBySeat = (seat: Seat): (number | 'pass')[] => {
        const run = bidLog.filter((b) => b.seat === seat).map((b) => b.bid);
        if (run.length > 0) return run;
        const only = h.bids?.[seat];
        return only === undefined ? [] : [only];
    };

    const cardRow = (cards: Card[], key: string) => (
        <div className="flex -space-x-3.5 min-w-0" key={key}>
            {sortHand(cards, h.trump).map((card) => (
                <PlayingCard key={`${card.suit}-${card.number}`} card={card} trump={h.trump} size="xs" />
            ))}
        </div>
    );

    const nested = (label: string, cards: Card[]) => (
        <div className="flex items-center gap-2 pl-4">
            <div className="w-14 flex-shrink-0">
                <span className="text-[9px] font-orbitron text-white/50 uppercase tracking-wide">{label}</span>
            </div>
            {cardRow(cards, label)}
        </div>
    );

    // the nine the taker KEPT: dealt + widow, minus what went down
    const buried = new Set(goDown.map((c) => `${c.suit}-${c.number}`));
    const keptHand = [...h.dealtHands[h.bidWinner], ...(h.dealtWidow ?? [])]
        .filter((c) => !buried.has(`${c.suit}-${c.number}`));

    return (
        <div>
            <div className="text-white/50 font-orbitron text-[11px] uppercase tracking-widest mb-2">
                The Deal &amp; Auction
            </div>
            <div className="space-y-2.5">
                {seatsFromDealer(h.dealer).map((seat) => {
                    const isWinner = seat === h.bidWinner;
                    const bids = bidsBySeat(seat);
                    return (
                        <div key={seat} className={isWinner ? 'rounded-lg bg-yellow-400/[0.06] -mx-1 px-1 py-1' : ''}>
                            <div className="flex items-start gap-2">
                                <div className="w-16 flex-shrink-0 flex flex-col items-start gap-1 pt-1">
                                    <span className={`text-[11px] font-orbitron truncate max-w-full ${teamOf(seat) === 'A' ? 'text-sky-300' : 'text-orange-300'}`}>
                                        {firstName(seats, seat)}
                                    </span>
                                    {h.dealer === seat && (
                                        <span className="flex items-center gap-0.5 px-1.5 py-px rounded-md bg-yellow-400 text-navy-950 text-[9px] font-orbitron font-bold">
                                            <span className="material-symbols-outlined" style={{ fontSize: 10 }}>playing_cards</span>
                                            DEALER
                                        </span>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    {cardRow(h.dealtHands![seat], 'hand')}
                                    {/* the seat's whole auction, under their cards */}
                                    {bids.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-1">
                                            {bids.map((bid, i) => (
                                                <span key={i} className={bidChipClass(
                                                    isWinner && bid === h.bid ? 'win' : bid === 'pass' ? 'pass' : 'live',
                                                )}>
                                                    {bid === 'pass' ? 'PASS' : bid}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                            {/* the taker's cards live under the taker */}
                            {isWinner && (
                                <div className="mt-1.5 space-y-1.5">
                                    {h.dealtWidow && h.dealtWidow.length > 0 &&
                                        nested('Widow', h.dealtWidow)}
                                    {h.dealtWidow && h.dealtWidow.length > 0 && goDown.length > 0 &&
                                        nested('New Hand', keptHand)}
                                    {goDown.length > 0 &&
                                        nested('Go-Down', goDown)}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

const teamNames = (seats: Seats, t: Team) =>
    t === 'A'
        ? `${firstName(seats, 'A1')} & ${firstName(seats, 'A2')}`
        : `${firstName(seats, 'B1')} & ${firstName(seats, 'B2')}`;

/** Trick-by-trick replay, with the "…got SET!" beat dropped in exactly where
 *  the set became inevitable — and the "laid them down" beat where a player
 *  claimed the rest. Shared by the live recap and the review page. */
export function TrickByTrick({ seats, tricks, trump, h, mySeat, compact, laydown }: {
    seats: Seats;
    tricks: TrickRecord[];
    trump: Suit | null;
    h: HandSummary;
    mySeat?: Seat | null;
    compact?: boolean;
    /** who laid their hand down, and before which trick (0-indexed) */
    laydown?: { seat: Seat; trick: number } | null;
}) {
    const sealed = setSealedTrick(tricks, h);
    const bidTeam = teamOf(h.bidWinner);
    const myTeam = mySeat ? teamOf(mySeat) : null;
    const setBanner = () => {
        const names = teamNames(seats, bidTeam);
        const { emoji, text } =
            myTeam === bidTeam ? { emoji: '😭', text: 'Oh no — we got SET!' }
            : myTeam ? { emoji: '🎉', text: `${names} got SET!` }
            : { emoji: '💥', text: `${names} got SET!` };
        return (
            <div className="flex items-center justify-center gap-2 my-1 py-2 px-3 rounded-xl bg-red-900/50 border border-red-400/40">
                <span className="text-lg leading-none">{emoji}</span>
                <span className="font-orbitron text-red-200 text-sm font-bold text-center">{text}</span>
            </div>
        );
    };

    const laydownBanner = laydown && (
        <div className="flex items-center justify-center gap-2 my-1 py-2 px-3 rounded-xl bg-sky-800/50 border border-sky-400/40">
            <span className="text-lg leading-none">🙌</span>
            <span className="font-orbitron text-sky-200 text-sm font-bold text-center">
                {firstName(seats, laydown.seat)} laid them down — the rest were all winners
            </span>
        </div>
    );

    const numW = compact ? 'w-6 text-lg' : 'w-7 text-2xl';
    return (
        <div className={compact ? 'space-y-3' : 'space-y-4'}>
            {laydown && laydown.trick === 0 && laydownBanner}
            {tricks.map((trick, idx) => (
                <div key={idx}>
                    {laydown && laydown.trick === idx && idx > 0 && laydownBanner}
                    <div className="flex items-center gap-2">
                        <div className={`${numW} flex-shrink-0 text-white/40 font-orbitron font-bold text-center`}>
                            {idx + 1}
                        </div>
                        <div className="grid grid-cols-4 gap-1.5 flex-1">
                            {trick.plays.map(({ seat, card }) => {
                                const isWinner = seat === trick.winner;
                                return (
                                    <div key={seat} className="flex flex-col items-center gap-1">
                                        <span className={`px-1.5 py-px rounded text-[10px] font-orbitron max-w-full truncate ${isWinner ? 'bg-yellow-500/20 text-yellow-300 font-bold' : 'text-white/60'}`}>
                                            {firstName(seats, seat)}
                                        </span>
                                        <PlayingCard card={card} trump={trump} size="sm" highlight={isWinner} />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    {idx === sealed && setBanner()}
                </div>
            ))}
        </div>
    );
}

export default function HandRecapModal({ game, mySeat, onNextHand, onShowScores }: HandRecapModalProps) {
    const h = game.handHistory[game.handHistory.length - 1];
    if (!h) return null;

    const bidTeam = teamOf(h.bidWinner);
    const bidderName = firstName(game.seats, h.bidWinner);
    const moments = trophyMoments(h, mySeat);
    const bigMoment = moments.some((m) => m.big);

    const teamLabel = (t: Team) =>
        t === 'A'
            ? `${firstName(game.seats, 'A1')} & ${firstName(game.seats, 'A2')}`
            : `${firstName(game.seats, 'B1')} & ${firstName(game.seats, 'B2')}`;

    return (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="relative bg-navy-950 border border-white/15 rounded-2xl shadow-2xl w-full max-w-md max-h-[92dvh] flex flex-col overflow-hidden">
                {bigMoment && <ConfettiBurst count={34} spread={260} origin={{ x: 50, y: 20 }} />}
                {/* verdict */}
                <div className={`px-5 py-3.5 text-center flex-shrink-0 ${h.wentSet ? 'bg-red-900/60' : 'bg-sky-800/60'}`}>
                    <div className="font-orbitron text-white text-xl font-bold">
                        {h.wentSet ? `${bidderName} went SET!` : `${bidderName} made it!`}
                    </div>
                    <div className="text-white/80 text-xs mt-0.5 font-orbitron">
                        Bid {h.bid} · took {h.pointsTaken[bidTeam]} · {h.trump} trump
                    </div>
                </div>

                <div className="px-5 py-4 space-y-4 overflow-y-auto custom-scrollbar flex-1 min-h-0">
                    {/* your trophy moments, celebrated the second they happen */}
                    {moments.length > 0 && (
                        <div className="rounded-xl border border-yellow-400/50 bg-gradient-to-r from-yellow-500/15 via-yellow-400/10 to-yellow-500/15 p-3 space-y-1.5 animate-card-reveal">
                            <div className="flex items-center gap-1.5 text-yellow-300 font-orbitron text-[11px] uppercase tracking-widest">
                                <span className="material-symbols-outlined text-sm animate-trophy-shine">trophy</span>
                                Trophy moments
                            </div>
                            {moments.map((m, i) => (
                                <div key={i} className="flex items-center gap-2.5">
                                    <span className="text-xl leading-none">{m.emoji}</span>
                                    <span className={`font-orbitron text-sm ${m.big ? 'text-yellow-300 font-bold' : 'text-white/90'}`}>
                                        {m.text}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* one scoreboard: hand score → updated game score */}
                    <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
                        <div className="grid grid-cols-2 divide-x divide-white/10">
                            {(['A', 'B'] as const).map((t) => (
                                <div key={t} className={`p-3 text-center ${t === bidTeam ? 'bg-yellow-500/[0.06]' : ''}`}>
                                    <div className={`font-orbitron text-[11px] truncate ${t === 'A' ? 'text-sky-300' : 'text-orange-300'}`}>
                                        {teamLabel(t)}
                                    </div>
                                    <div className="flex items-baseline justify-center gap-2 mt-1">
                                        <span className={`font-orbitron text-lg font-bold ${h.handScore[t] < 0 ? 'text-red-400' : 'text-white'}`}>
                                            {h.handScore[t] >= 0 ? '+' : ''}{h.handScore[t]}
                                        </span>
                                        <span className="text-white/40 text-xs">→</span>
                                        <span className="font-orbitron text-2xl font-bold text-yellow-400">
                                            {game.scores[t]}
                                        </span>
                                    </div>
                                    <div className="text-white/50 text-[10px] flex items-center justify-center gap-1.5 mt-0.5">
                                        <span>{h.tricksWon[t]} trick{h.tricksWon[t] === 1 ? '' : 's'}</span>
                                        {h.tricksWon[t] >= 5 && (
                                            <span className="px-1 rounded bg-yellow-500/20 text-yellow-300 font-orbitron">+20</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* the deal + auction, one section, with the taker's widow
                        and go-down nested under them */}
                    <DealBreakdown seats={game.seats} h={h} goDown={game.goDown} />

                    {/* trick-by-trick review, straight from v1 — with the SET
                        beat dropped in where the hand turned */}
                    <div className="pt-2 border-t border-white/10">
                        <div className="text-white/50 font-orbitron text-[11px] uppercase tracking-widest mb-3">
                            Trick by trick
                        </div>
                        <TrickByTrick
                            seats={game.seats}
                            tricks={game.completedTricks}
                            trump={game.trump}
                            h={h}
                            mySeat={mySeat}
                            laydown={game.laydownSeat != null && game.laydownTrick != null
                                ? { seat: game.laydownSeat, trick: game.laydownTrick }
                                : null}
                        />
                    </div>
                </div>

                {/* pinned actions — always reachable, however long the recap */}
                <div className="flex gap-2 px-5 py-3 border-t border-white/10 bg-navy-950/95 flex-shrink-0">
                    <button
                        onClick={onShowScores}
                        className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-orbitron text-sm"
                    >
                        Score Sheet
                    </button>
                    <button
                        onClick={onNextHand}
                        className="flex-[2] py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-orbitron text-sm font-bold active:scale-95 transition"
                    >
                        Next Hand →
                    </button>
                </div>
            </div>
        </div>
    );
}
