'use client';

import { Seat, SeatInfo, BotStyle, BOT_STYLE_LABELS, teamOf } from '@/lib/game/types';
import { ASSIST_PINK } from './AssistDial';
import BotAvatar from './BotAvatar';

interface PlayerBadgeProps {
    seat: Seat;
    info: SeatInfo;
    isDealer: boolean;
    isTurn: boolean;
    bid?: number | 'pass';
    cardsLeft?: number;
    horizontal?: boolean; // side seats stack vertically by default
}

// The rank chip a bot wears — its AlphaRook generation (so the camp names
// stay honest about who's actually the strongest), or the difficulty name
// for the legacy heuristic bots.
function botChip(style: BotStyle | undefined): string {
    if (style && /^gen(\d+)$/.test(style)) return `AI·${style.slice(3)}`;
    return style ? BOT_STYLE_LABELS[style] : 'Bot';
}

export default function PlayerBadge({ seat, info, isDealer, isTurn, bid, cardsLeft, horizontal }: PlayerBadgeProps) {
    const team = teamOf(seat);
    const isA = team === 'A';
    const teamBorder = isA ? 'border-sky-400' : 'border-orange-400';
    // team color soaks the avatar so partnerships read at a glance
    const teamFill = isA ? 'bg-sky-900/70' : 'bg-orange-900/70';
    const chipColor = isA ? 'bg-sky-600 text-white' : 'bg-orange-600 text-white';
    const firstName = info.name.split(' ')[0];
    const isBot = info.kind === 'bot';
    const chip = isBot ? botChip(info.botStyle) : null;

    return (
        <div className={`flex ${horizontal ? 'flex-row items-center gap-2' : 'flex-col items-center gap-1'}`}>
            <div className="relative">
                <div className={`
                    w-11 h-11 sm:w-14 sm:h-14 rounded-full border-2 ${teamBorder} ${teamFill}
                    flex items-center justify-center overflow-hidden
                    transition-shadow duration-300
                    ${isTurn ? 'ring-4 ring-yellow-400/80 shadow-[0_0_18px_4px_rgba(234,179,8,0.55)]' : ''}
                `}>
                    {info.kind === 'human' && info.photoURL ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={info.photoURL} alt={info.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : isBot ? (
                        <BotAvatar style={info.botStyle} className="w-full h-full" />
                    ) : (
                        <span className="text-white font-orbitron text-lg">{firstName.charAt(0)}</span>
                    )}
                </div>
                {/* bot rank chip: the AlphaRook gen (or difficulty), team-tinted,
                    sits on the shoulder of the avatar */}
                {chip && (
                    <div className={`absolute -bottom-1 -left-1 px-1 h-4 min-w-[1rem] rounded-full ${chipColor} border border-white/30 flex items-center justify-center shadow`}
                        title={info.botStyle ? BOT_STYLE_LABELS[info.botStyle] : 'Bot'}>
                        <span className="text-[9px] font-orbitron font-bold leading-none px-0.5">{chip}</span>
                    </div>
                )}
                {/* dealer chip: the yellow card badge the family knows from v1 */}
                {isDealer && (
                    <div className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full bg-yellow-400 border-2 border-yellow-200/80 flex items-center justify-center shadow-md"
                        title="Dealer">
                        <span className="material-symbols-outlined text-navy-950" style={{ fontSize: 15 }}>playing_cards</span>
                    </div>
                )}
                {/* cards left: shaped like a tiny card back */}
                {cardsLeft !== undefined && cardsLeft > 0 && (
                    <div className="absolute -top-1.5 -left-1.5 w-[1.15rem] h-[1.5rem] rounded-[4px] bg-navy-800 border border-white/50 flex items-center justify-center shadow"
                        title={`${cardsLeft} cards left`}>
                        <span className="text-white text-[11px] font-bold leading-none">{cardsLeft}</span>
                    </div>
                )}
                {/* AI trainer: this player has a coach over their shoulder —
                    hot pink, the assistant's signature color */}
                {info.kind === 'human' && info.assist && (
                    <div className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full border-2 border-white/70 flex items-center justify-center shadow-md"
                        style={{ backgroundColor: ASSIST_PINK }}
                        title={`${firstName} has the AI trainer on`}>
                        <span className="material-symbols-outlined text-white" style={{ fontSize: 14 }}>neurology</span>
                    </div>
                )}
            </div>
            <div className={`flex ${horizontal ? 'flex-col items-start' : 'flex-col items-center'} leading-tight`}>
                <span className="text-white font-orbitron text-xs sm:text-sm drop-shadow max-w-[5.5rem] truncate">{firstName}</span>
                {bid !== undefined && (
                    bid === 'pass' ? (
                        <span className="text-xs sm:text-sm px-2 py-0.5 rounded-md bg-gray-800/90 text-gray-300 font-orbitron mt-1">PASS</span>
                    ) : (
                        <span className={`text-xs sm:text-sm px-2.5 py-0.5 rounded-md ${isA ? 'bg-sky-600' : 'bg-orange-600'} text-white font-orbitron font-bold mt-1 shadow`}>{bid}</span>
                    )
                )}
            </div>
        </div>
    );
}
