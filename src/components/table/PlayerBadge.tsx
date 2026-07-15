'use client';

import { Seat, SeatInfo, teamOf } from '@/lib/game/types';
import { ASSIST_PINK } from './AssistDial';
import BotAvatar from './BotAvatar';

interface PlayerBadgeProps {
    seat: Seat;
    info: SeatInfo;
    isDealer: boolean;
    isTurn: boolean;
    bid?: number | 'pass';
    horizontal?: boolean; // side seats stack vertically by default
}

export default function PlayerBadge({ seat, info, isDealer, isTurn, bid, horizontal }: PlayerBadgeProps) {
    const team = teamOf(seat);
    const isA = team === 'A';
    const teamBorder = isA ? 'border-sky-400' : 'border-orange-400';
    // team color soaks the avatar so partnerships read at a glance
    const teamFill = isA ? 'bg-sky-900/70' : 'bg-orange-900/70';
    const firstName = info.name.split(' ')[0];
    const isBot = info.kind === 'bot';

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
                {/* dealer chip: the yellow card badge the family knows from v1 */}
                {isDealer && (
                    <div className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full bg-yellow-400 border-2 border-yellow-200/80 flex items-center justify-center shadow-md"
                        title="Dealer">
                        <span className="material-symbols-outlined text-navy-950" style={{ fontSize: 15 }}>playing_cards</span>
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
