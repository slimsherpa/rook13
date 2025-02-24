'use client';

import { useState } from 'react';
import { useGameStore } from '@/lib/store/gameStore';
import { Player, Seat } from '@/lib/types/game';
import { v4 as uuidv4 } from 'uuid';
import GameTable from '../game/GameTable';

export default function Lobby() {
    const [playerName, setPlayerName] = useState('');
    const { game, createGame, addBot, setPlayerReady } = useGameStore();

    const handleStartGame = () => {
        if (!playerName.trim()) return;

        const humanPlayer: Player = {
            id: uuidv4(),
            name: playerName,
            type: 'human',
            ready: false,
        };

        createGame(humanPlayer);
        
        // Automatically add bots to other seats
        const botSeats: Seat[] = ['B1', 'A2', 'B2'];
        botSeats.forEach(seat => addBot(seat));
        
        // Set human player as ready
        setPlayerReady('A1');
    };

    // Show game table when game is active
    if (game?.status === 'active') {
        return <GameTable />;
    }

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-100">
            <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
                <h1 className="text-3xl font-bold text-center mb-6">Rook13</h1>
                
                {!game ? (
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="playerName" className="block text-sm font-medium text-gray-700 mb-1">
                                Your Name
                            </label>
                            <input
                                type="text"
                                id="playerName"
                                value={playerName}
                                onChange={(e) => setPlayerName(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Enter your name"
                            />
                        </div>
                        <button
                            onClick={handleStartGame}
                            disabled={!playerName.trim()}
                            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                        >
                            Start Game with Bots
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <h2 className="text-xl font-semibold">Players</h2>
                        <div className="space-y-2">
                            {Object.entries(game.players).map(([seat, player]) => (
                                <div key={seat} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                                    <span>{seat}: {player?.name || 'Empty'}</span>
                                    <span className="text-sm text-gray-500">
                                        {player?.type === 'bot' ? 'Bot' : 'Human'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
} 