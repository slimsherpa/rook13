'use client';

import { useEffect } from 'react';
import { useGameStore } from '@/lib/store/gameStore';
import { Player, Seat } from '@/lib/types/game';
import { v4 as uuidv4 } from 'uuid';
import GameTable from '../game/GameTable';
import { useAuth } from '@/lib/hooks/useAuth';

export default function Lobby() {
    const { game, createGame, addBot, setPlayerReady } = useGameStore();
    const { user, loading, signInWithGoogle } = useAuth();

    // When user logs in, automatically create a game with their profile info
    useEffect(() => {
        if (user && !game) {
            const humanPlayer: Player = {
                id: user.uid,
                name: user.displayName || 'Player',
                type: 'human',
                ready: false,
            };

            createGame(humanPlayer);
            
            // Automatically add bots to other seats
            const botSeats: Seat[] = ['B1', 'A2', 'B2'];
            botSeats.forEach(seat => addBot(seat));
            
            // Set human player as ready
            setPlayerReady('A1');
        }
    }, [user, game, createGame, addBot, setPlayerReady]);

    // Show game table when game is active
    if (game?.status === 'active') {
        return <GameTable />;
    }

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-100">
            <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
                <h1 className="text-3xl font-bold text-center mb-6">Rook13</h1>
                
                {loading ? (
                    <div className="text-center py-4">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                        <p className="mt-4 text-gray-600">Loading...</p>
                    </div>
                ) : !user ? (
                    <div className="space-y-4">
                        <p className="text-gray-600 text-center mb-4">
                            Sign in with your Google account to start playing Rook13
                        </p>
                        <button
                            onClick={signInWithGoogle}
                            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.032s2.701-6.032,6.033-6.032c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C7.021,2,2.543,6.477,2.543,12s4.478,10,10.002,10c8.396,0,10.249-7.85,9.426-11.748L12.545,10.239z"/>
                            </svg>
                            Sign in with Google
                        </button>
                    </div>
                ) : !game ? (
                    <div className="text-center py-4">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                        <p className="mt-4 text-gray-600">Setting up your game...</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="bg-blue-50 p-4 rounded-lg mb-4">
                            <p className="text-blue-800 font-medium">Welcome, {user.displayName}!</p>
                            <p className="text-blue-600 text-sm">{user.email}</p>
                        </div>
                        
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