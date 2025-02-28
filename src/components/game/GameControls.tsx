import React from 'react';
import { useGameStore } from '@/lib/store/gameStore';

interface GameControlsProps {
    botSpeed: number;
    onBotSpeedChange: (speed: number) => void;
}

const BOT_SPEED_OPTIONS = [
    { value: 0.1, label: '0.1 sec' },
    { value: 0.5, label: '0.5 sec' },
    { value: 1, label: '1 sec' },
    { value: 2, label: '2 sec' },
];

export default function GameControls({ botSpeed, onBotSpeedChange }: GameControlsProps) {
    const { game, toggleGodMode } = useGameStore();

    return (
        <div className="absolute bottom-4 left-4 flex flex-col gap-2 bg-green-900/80 backdrop-blur-sm p-3 rounded-lg border border-green-700 shadow-lg">
            <div className="flex items-center gap-2">
                <label className="text-white text-sm font-medium">Bot Speed:</label>
                <select
                    value={botSpeed}
                    onChange={(e) => onBotSpeedChange(Number(e.target.value))}
                    className="bg-green-800 text-white text-sm rounded border border-green-700 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-green-600"
                >
                    {BOT_SPEED_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
            </div>
            
            <div className="flex items-center justify-between">
                <label className="text-white text-sm font-medium">God Mode:</label>
                <button
                    onClick={toggleGodMode}
                    className={`px-3 py-1 rounded-md font-medium transition-colors ${
                        game?.godMode
                            ? 'bg-yellow-500 hover:bg-yellow-600 text-black'
                            : 'bg-gray-600 hover:bg-gray-700 text-gray-300'
                    }`}
                >
                    {game?.godMode ? 'ON' : 'OFF'}
                </button>
            </div>
        </div>
    );
} 