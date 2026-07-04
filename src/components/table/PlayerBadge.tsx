'use client';

import { Seat, SeatInfo, teamOf } from '@/lib/game/types';

interface PlayerBadgeProps {
    seat: Seat;
    info: SeatInfo;
    isDealer: boolean;
    isTurn: boolean;
    bid?: number | 'pass';
    cardsLeft?: number;
    horizontal?: boolean; // side seats stack vertically by default
}

export default function PlayerBadge({ seat, info, isDealer, isTurn, bid, cardsLeft, horizontal }: PlayerBadgeProps) {
    const team = teamOf(seat);
    const teamColor = team === 'A' ? 'border-sky-400' : 'border-orange-400';
    const firstName = info.name.split(' ')[0];

    return (
        <div className={`flex ${horizontal ? 'flex-row items-center gap-2' : 'flex-col items-center gap-1'}`}>
            <div className="relative">
                <div className={`
                    w-11 h-11 sm:w-14 sm:h-14 rounded-full border-2 ${teamColor}
                    bg-green-950 flex items-center justify-center overflow-hidden
                    transition-shadow duration-300
                    ${isTurn ? 'ring-4 ring-yellow-400/80 shadow-[0_0_18px_4px_rgba(234,179,8,0.55)]' : ''}
                `}>
                    {info.kind === 'human' && info.photoURL ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={info.photoURL} alt={info.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : info.kind === 'bot' ? (
                        <span className="material-symbols-outlined text-white/85 text-2xl">smart_toy</span>
                    ) : (
                        <span className="text-white font-orbitron text-lg">{firstName.charAt(0)}</span>
                    )}
                </div>
                {isDealer && (
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-yellow-400 border border-yellow-200 flex items-center justify-center shadow"
                        title="Dealer">
                        <span className="text-green-950 text-[10px] font-black">D</span>
                    </div>
                )}
                {cardsLeft !== undefined && cardsLeft > 0 && (
                    <div className="absolute -top-1 -left-1 min-w-[1.1rem] h-[1.1rem] px-0.5 rounded-full bg-navy-800 border border-white/30 flex items-center justify-center"
                        title={`${cardsLeft} cards`}>
                        <span className="text-white text-[10px] font-bold">{cardsLeft}</span>
                    </div>
                )}
            </div>
            <div className={`flex ${horizontal ? 'flex-col items-start' : 'flex-col items-center'} leading-tight`}>
                <span className="text-white font-orbitron text-xs sm:text-sm drop-shadow max-w-[5.5rem] truncate">{firstName}</span>
                {bid !== undefined && (
                    bid === 'pass' ? (
                        <span className="text-[10px] sm:text-xs px-1.5 rounded bg-gray-800/80 text-gray-300 font-orbitron mt-0.5">PASS</span>
                    ) : (
                        <span className="text-[10px] sm:text-xs px-1.5 rounded bg-sky-600 text-white font-orbitron font-bold mt-0.5">{bid}</span>
                    )
                )}
            </div>
        </div>
    );
}
