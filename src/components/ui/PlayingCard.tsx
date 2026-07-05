'use client';

// The Rook13 card face. Pure presentational — no store dependencies — so it
// works in hands, tricks, recaps, and history views alike. Sized responsively
// via the `size` prop; `compact` sizes keep 13 cards playable on a phone.

import { Card, Suit, getCardPoints } from '@/lib/game/types';
import RookBird from './RookBird';

export type CardSize = 'xs' | 'sm' | 'md' | 'lg';

interface PlayingCardProps {
    card?: Card;            // omit (or faceDown) renders the card back
    faceDown?: boolean;
    trump?: Suit | null;
    size?: CardSize;
    onClick?: () => void;
    disabled?: boolean;     // unplayable right now (dimmed)
    selected?: boolean;     // raised + ring (go-down picking)
    highlight?: boolean;    // winning card glow
    className?: string;
}

const SIZES: Record<CardSize, string> = {
    xs: 'w-8 h-12 rounded-md text-[10px]',
    sm: 'w-10 h-[3.75rem] rounded-md text-xs',
    md: 'w-12 h-[4.5rem] sm:w-14 sm:h-[5.25rem] rounded-lg text-sm',
    lg: 'w-14 h-[5.25rem] sm:w-16 sm:h-24 rounded-lg text-base',
};

const CIRCLE: Record<CardSize, string> = {
    xs: 'w-4 h-4 text-[8px]',
    sm: 'w-5 h-5 text-[10px]',
    md: 'w-7 h-7 sm:w-8 sm:h-8 text-xs sm:text-sm',
    lg: 'w-8 h-8 sm:w-10 sm:h-10 text-sm sm:text-lg',
};

const suitText: Record<Suit, string> = {
    Red: 'text-red-600',
    Yellow: 'text-yellow-500',
    Black: 'text-gray-900',
    Green: 'text-green-600',
};

const suitBg: Record<Suit, string> = {
    Red: 'bg-red-600',
    Yellow: 'bg-yellow-500',
    Black: 'bg-gray-900',
    Green: 'bg-green-600',
};

export default function PlayingCard({
    card, faceDown, trump, size = 'md', onClick, disabled, selected, highlight, className = '',
}: PlayingCardProps) {
    const base = `relative flex-shrink-0 border-2 shadow-md select-none transition-all duration-200 ${SIZES[size]} ${className}`;

    if (faceDown || !card) {
        return (
            <div className={`${base} border-navy-900 bg-navy-800 flex items-center justify-center`}>
                <div className="absolute inset-1 border border-navy-700 rounded opacity-80" />
                <RookBird className={`text-white/75 ${size === 'xs' ? 'w-4 h-4' : size === 'sm' ? 'w-5 h-5' : 'w-8 h-8'}`} />
            </div>
        );
    }

    const isTrump = trump != null && card.suit === trump;
    const points = getCardPoints(card);

    const face = isTrump
        ? `text-white ${suitBg[card.suit]} border-white/40`
        : `bg-white ${suitText[card.suit]} border-gray-300`;

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={!onClick}
            className={`${base} ${face}
                ${selected ? '-translate-y-3 ring-2 ring-sky-400 border-sky-400' : ''}
                ${highlight ? 'ring-2 ring-yellow-400 shadow-[0_0_14px_4px_rgba(234,179,8,0.5)]' : ''}
                ${disabled ? 'opacity-50 saturate-50' : ''}
                ${onClick && !disabled ? 'cursor-pointer active:brightness-90' : ''}
            `}
        >
            <span className="absolute top-0.5 left-1 font-bold">{card.number}</span>
            <span className="absolute bottom-0.5 right-1 font-bold rotate-180">{card.number}</span>
            <span className="absolute inset-0 flex items-center justify-center">
                <span className={`${CIRCLE[size]} rounded-full flex items-center justify-center font-bold
                    ${isTrump ? 'bg-white' : suitBg[card.suit]}
                    ${isTrump ? suitText[card.suit] : 'text-white'}`}
                >
                    {points > 0 ? points : ''}
                </span>
            </span>
        </button>
    );
}
