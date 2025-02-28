'use client';

import { Card as CardType, Suit } from '@/lib/types/game';
import { useGameStore } from '@/lib/store/gameStore';

interface CardProps {
    card: CardType;
    onClick?: () => void;
    disabled?: boolean;
    selected?: boolean;
    selectable?: boolean;
    faceDown?: boolean;
    highlight?: boolean;
    dimmed?: boolean;
}

const suitColors: Record<Suit, string> = {
    'Red': 'text-red-600 bg-white hover:bg-red-50',
    'Yellow': 'text-yellow-600 bg-white hover:bg-yellow-50',
    'Black': 'text-gray-900 bg-white hover:bg-gray-50',
    'Green': 'text-green-600 bg-white hover:bg-green-50',
};

const trumpSuitColors: Record<Suit, string> = {
    'Red': 'text-white bg-red-600 hover:bg-red-700',
    'Yellow': 'text-white bg-yellow-600 hover:bg-yellow-700',
    'Black': 'text-white bg-gray-900 hover:bg-gray-950',
    'Green': 'text-white bg-green-600 hover:bg-green-700',
};

const suitCircleColors: Record<Suit, string> = {
    'Red': 'bg-red-600',
    'Yellow': 'bg-yellow-500',
    'Black': 'bg-gray-900',
    'Green': 'bg-green-600',
};

export default function Card({ card, onClick, disabled, selected, selectable, faceDown, highlight, dimmed }: CardProps) {
    const { suit, number, points } = card;
    const { game } = useGameStore();
    const isTrump = game?.trump === suit;
    
    const colorClasses = isTrump ? trumpSuitColors[suit] : suitColors[suit];

    // If the card is face down, show the card back
    if (faceDown || (suit === 'Black' && number === 0)) {
        return (
            <button
                disabled={true}
                className={`
                    relative w-16 h-24 rounded-lg border-2 border-navy-900
                    bg-navy-800 text-white shadow-lg
                    transition-all duration-200
                    flex items-center justify-center
                `}
            >
                {/* Card back pattern */}
                <div className="absolute inset-1 border-2 border-navy-700 rounded-md opacity-80" />
                
                {/* Raven icon */}
                <div className="relative">
                    <span className="material-symbols-outlined text-4xl">
                        raven
                    </span>
                </div>
            </button>
        );
    }
    
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`
                relative w-16 h-24 rounded-lg border-2 shadow-lg
                ${selected ? 'border-blue-500 transform -translate-y-4' : 
                  highlight ? 'border-yellow-400/70' :
                  selectable ? 'border-gray-300 hover:border-blue-300 hover:-translate-y-2' :
                  'border-gray-300'}
                ${disabled ? 'cursor-not-allowed' : 
                  selectable ? 'cursor-pointer' : ''}
                ${colorClasses}
                ${dimmed ? 'opacity-60 grayscale-[30%]' : ''}
                transition-all duration-300 ease-in-out
                z-10
            `}
        >
            {/* Glow effect wrapper - moved before content */}
            {highlight && (
                <div className="absolute inset-0 rounded-lg bg-yellow-400/10 shadow-[0_0_16px_6px_rgba(234,179,8,0.5)] -z-10" />
            )}

            {/* Top left */}
            <div className="absolute top-1 left-1 font-bold">
                {number}
            </div>
            
            {/* Bottom right */}
            <div className="absolute bottom-1 right-1 rotate-180 font-bold">
                {number}
            </div>
            
            {/* Center circle with points */}
            <div className="absolute inset-0 flex items-center justify-center">
                <div className={`
                    w-10 h-10 rounded-full 
                    ${isTrump ? 'bg-white' : suitCircleColors[suit]}
                    flex items-center justify-center
                    ${isTrump ? 'shadow-[0_0_12px_rgba(255,255,255,0.2)]' : ''}
                    transition-all duration-200
                `}>
                    {points > 0 && (
                        <span className={`
                            font-bold text-lg
                            ${isTrump ? (
                                suit === 'Red' ? 'text-red-600' :
                                suit === 'Yellow' ? 'text-yellow-600' :
                                suit === 'Black' ? 'text-gray-900' :
                                'text-green-600'
                            ) : 'text-white'}
                        `}>
                            {points}
                        </span>
                    )}
                </div>
            </div>

            {/* Selection overlay */}
            {selected && (
                <div className="absolute inset-0 bg-blue-500 bg-opacity-20 rounded-lg flex items-center justify-center">
                    <div className="bg-blue-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold">
                        ✓
                    </div>
                </div>
            )}

            {/* Selectable indicator */}
            {selectable && !selected && (
                <div className="absolute inset-0 bg-blue-500 bg-opacity-0 hover:bg-opacity-10 rounded-lg flex items-center justify-center">
                    <div className="bg-blue-500 bg-opacity-0 hover:bg-opacity-100 text-transparent hover:text-white w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-200">
                        +
                    </div>
                </div>
            )}
        </button>
    );
} 