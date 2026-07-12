'use client';

// Shown when a hand finishes (phase 'hand_done'). Crisp, top to bottom:
// the verdict, one scoreboard (hand score → updated game score), the deal
// itself — every hand as dealt, each seat's bid with the winner lit up, the
// widow and the go-down — then the trick-by-trick review the family loved
// in v1. The Next Hand button stays pinned at the bottom no matter how far
// you scroll. Any player can start the next hand.

import { Card, GameDoc, Seat, Team, HandSummary, teamOf, nextSeat } from '@/lib/game/types';
import { sortHand } from '@/lib/game/deck';
import PlayingCard from '@/components/ui/PlayingCard';

interface HandRecapModalProps {
    game: GameDoc;
    onNextHand: () => void;
    onShowScores: () => void;
}

type Seats = GameDoc['seats'];

const firstName = (seats: Seats, seat: Seat) => seats[seat].name.split(' ')[0];

/** Seats in auction order: dealer's left first, clockwise. */
const seatsFromDealer = (dealer: Seat): Seat[] => {
    const first = nextSeat(dealer);
    return [first, nextSeat(first), nextSeat(nextSeat(first)), nextSeat(nextSeat(nextSeat(first)))];
};

/** The dealt hands + bids + widow + go-down, one compact row per seat.
 *  Shared between the live recap and the /review page. */
export function DealBreakdown({ seats, h, goDown, tricksSource }: {
    seats: Seats;
    h: HandSummary;
    goDown: Card[];
    /** completed tricks of this hand, for "who got the go-down" */
    tricksSource: { winner: Seat }[];
}) {
    if (!h.dealtHands) return null;
    const lastTrick = tricksSource[tricksSource.length - 1];
    const goDownSeat = lastTrick?.winner ?? h.bidWinner;

    const bidChip = (seat: Seat) => {
        const bid = h.bids?.[seat];
        if (bid === undefined) return null;
        const isWinner = seat === h.bidWinner;
        return (
            <span className={`px-1.5 py-px rounded-md text-[10px] font-orbitron font-bold flex-shrink-0 ${
                isWinner
                    ? 'bg-yellow-400 text-navy-950 shadow-[0_0_8px_rgba(234,179,8,0.45)]'
                    : bid === 'pass' ? 'bg-white/10 text-white/50' : 'bg-sky-800 text-sky-200'
            }`}>
                {bid === 'pass' ? 'PASS' : bid}
            </span>
        );
    };

    return (
        <div>
            <div className="text-white/50 font-orbitron text-[11px] uppercase tracking-widest mb-2">
                The Deal
            </div>
            <div className="space-y-1.5">
                {seatsFromDealer(h.dealer).map((seat) => (
                    <div key={seat} className="flex items-center gap-2">
                        <div className="w-16 flex-shrink-0 flex flex-col items-start gap-0.5">
                            <span className={`text-[11px] font-orbitron truncate max-w-full ${teamOf(seat) === 'A' ? 'text-sky-300' : 'text-orange-300'}`}>
                                {firstName(seats, seat)}{h.dealer === seat ? ' ·D' : ''}
                            </span>
                            {bidChip(seat)}
                        </div>
                        <div className="flex -space-x-3.5 flex-1 min-w-0">
                            {sortHand(h.dealtHands![seat], h.trump).map((card) => (
                                <PlayingCard key={`${card.suit}-${card.number}`} card={card} trump={h.trump} size="xs" />
                            ))}
                        </div>
                    </div>
                ))}
                {/* the widow, revealed */}
                {h.dealtWidow && h.dealtWidow.length > 0 && (
                    <div className="flex items-center gap-2 pt-1.5 mt-1.5 border-t border-white/10">
                        <div className="w-16 flex-shrink-0">
                            <span className="text-[10px] font-orbitron text-white/50 uppercase">Widow</span>
                        </div>
                        <div className="flex -space-x-3.5">
                            {sortHand(h.dealtWidow, h.trump).map((card) => (
                                <PlayingCard key={`${card.suit}-${card.number}`} card={card} trump={h.trump} size="xs" />
                            ))}
                        </div>
                    </div>
                )}
                {/* the go-down + where its points went */}
                {goDown.length > 0 && (
                    <div className="flex items-center gap-2">
                        <div className="w-16 flex-shrink-0 flex flex-col items-start">
                            <span className="text-[10px] font-orbitron text-white/50 uppercase">Go-Down</span>
                            <span className="text-[10px] text-white/40">{h.goDownPoints} pts → {firstName(seats, goDownSeat)}</span>
                        </div>
                        <div className="flex -space-x-3.5">
                            {sortHand(goDown, h.trump).map((card) => (
                                <PlayingCard key={`${card.suit}-${card.number}`} card={card} trump={h.trump} size="xs" />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function HandRecapModal({ game, onNextHand, onShowScores }: HandRecapModalProps) {
    const h = game.handHistory[game.handHistory.length - 1];
    if (!h) return null;

    const bidTeam = teamOf(h.bidWinner);
    const bidderName = firstName(game.seats, h.bidWinner);

    const teamLabel = (t: Team) =>
        t === 'A'
            ? `${firstName(game.seats, 'A1')} & ${firstName(game.seats, 'A2')}`
            : `${firstName(game.seats, 'B1')} & ${firstName(game.seats, 'B2')}`;

    return (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-navy-950 border border-white/15 rounded-2xl shadow-2xl w-full max-w-md max-h-[92dvh] flex flex-col overflow-hidden">
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

                    {/* the deal: hands, bids, widow, go-down */}
                    <DealBreakdown seats={game.seats} h={h} goDown={game.goDown} tricksSource={game.completedTricks} />

                    {/* trick-by-trick review, straight from v1 */}
                    <div className="pt-2 border-t border-white/10">
                        <div className="text-white/50 font-orbitron text-[11px] uppercase tracking-widest mb-3">
                            Trick by trick
                        </div>
                        <div className="space-y-4">
                            {game.completedTricks.map((trick, idx) => (
                                <div key={idx} className="flex items-center gap-2">
                                    <div className="w-7 flex-shrink-0 text-white/40 font-orbitron text-2xl font-bold text-center">
                                        {idx + 1}
                                    </div>
                                    <div className="grid grid-cols-4 gap-1.5 flex-1">
                                        {trick.plays.map(({ seat, card }) => {
                                            const isWinner = seat === trick.winner;
                                            return (
                                                <div key={seat} className="flex flex-col items-center gap-1">
                                                    <span className={`px-1.5 py-px rounded text-[10px] font-orbitron max-w-full truncate ${isWinner ? 'bg-yellow-500/20 text-yellow-300 font-bold' : 'text-white/60'}`}>
                                                        {firstName(game.seats, seat)}
                                                    </span>
                                                    <PlayingCard card={card} trump={game.trump} size="sm" highlight={isWinner} />
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
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
