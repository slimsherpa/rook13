'use client';

import { useState } from 'react';
import { useGameStore } from '@/lib/store/gameStore';
import { Player, Seat, Suit } from '@/lib/types/game';
import GameTable from '../game/GameTable';
import { useAuth } from '@/lib/hooks/useAuth';
import LoadingSpinner from '../LoadingSpinner';
import GameSetupModal from './GameSetupModal';
import TableCenterIcon from '../game/TableCenterIcon';
import { Card as CardType } from '@/lib/types/game';
import type { TeamSetup } from './GameSetupModal';

export default function Lobby() {
    const { game, createGame, addBot, setPlayerReady } = useGameStore();
    const { user, loading, signInWithGoogle, signOut } = useAuth();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isJayCupModalOpen, setIsJayCupModalOpen] = useState(false);
    const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);

    // Game table props
    const [hands, setHands] = useState<Record<Seat, CardType[]>>({
        'A1': [],
        'B1': [],
        'A2': [],
        'B2': []
    });
    const [trickCards, setTrickCards] = useState<Record<Seat, CardType | null>>({
        'A1': null,
        'B1': null,
        'A2': null,
        'B2': null
    });
    const [playedCards, setPlayedCards] = useState<CardType[]>([]);
    const [trump, setTrump] = useState<Suit | null>(null);
    const [trickLeader, setTrickLeader] = useState<Seat>('A1');

    const jayCupWinners = Array.from({ length: 20 }, (_, i) => ({
        name: `Champion ${i + 1}`,
        year: 2024 - i
    }));

    const isBot = (seat: Seat) => {
        if (!game?.players) return true;
        return game.players[seat]?.type === 'bot';
    };

    const handleStartGame = async (teamSetup: TeamSetup) => {
        if (!user) return;

        // Close modal first to prevent any race conditions
        setIsModalOpen(false);

        // Create initial player based on whether it's an all-bot game
        const player1: Player = teamSetup.teamA.isAllBots ? {
            id: `bot_${teamSetup.teamA.player1}`,
            name: teamSetup.teamA.player1,
            type: 'bot',
            ready: true, // Bot is always ready
        } : {
            id: user.uid,
            name: user.displayName || 'Player',
            type: 'human',
            ready: false,
        };

        // Create initial game with first player
        createGame(player1);

        // Add remaining bots in sequence
        // Wait a small delay between operations to ensure state updates properly
        await new Promise(resolve => setTimeout(resolve, 100));
        addBot('A2');
        await new Promise(resolve => setTimeout(resolve, 100));
        addBot('B1');
        await new Promise(resolve => setTimeout(resolve, 100));
        addBot('B2');

        // Now set them ready in sequence
        await new Promise(resolve => setTimeout(resolve, 100));
        setPlayerReady('A2');
        await new Promise(resolve => setTimeout(resolve, 100));
        setPlayerReady('B1');
        await new Promise(resolve => setTimeout(resolve, 100));
        setPlayerReady('B2');

        // For human games, set them ready last
        // For all-bot games, A1 is already ready since we created it with ready: true
        if (!teamSetup.teamA.isAllBots) {
            await new Promise(resolve => setTimeout(resolve, 100));
            setPlayerReady('A1');
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-green-800">
                <div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-green-800">
                <div className="absolute top-4 left-4 text-4xl font-bold text-white">ROOK</div>
                <div className="flex flex-col items-center gap-6">
                    <button
                        onClick={signInWithGoogle}
                        className="px-6 py-3 bg-white text-green-800 rounded-lg shadow-lg hover:bg-gray-100 transition-colors"
                    >
                        Sign in with Google to Play
                    </button>
                </div>
            </div>
        );
    }

    if (game?.status === 'active') {
        return (
            <GameTable
                hands={hands}
                setHands={setHands}
                trickCards={trickCards}
                setTrickCards={setTrickCards}
                playedCards={playedCards}
                trump={trump}
                trickLeader={trickLeader}
                isBot={isBot}
            />
        );
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-green-800">
            {/* ROOK Title - Styled like game board */}
            <div className="absolute top-8 left-8 z-40">
                <div className="font-orbitron text-[48px] font-bold text-white cursor-pointer hover:text-white/90 transition-colors relative group drop-shadow-[0_4px_8px_rgba(0,0,0,0.3)]">
                    ROOK
                    <span className="absolute -bottom-2 left-0 w-0 h-1 bg-white group-hover:w-full transition-all duration-300"></span>
                </div>
            </div>

            {/* User Profile with Dropdown */}
            <div className="absolute top-8 right-8 z-40">
                <div className="relative">
                    <div 
                        className="flex items-center gap-4 cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                    >
                        <span className="text-white font-orbitron">{user.displayName}</span>
                        <img 
                            src={user.photoURL || '/default-avatar.png'} 
                            alt="Profile" 
                            className="w-10 h-10 rounded-full border-2 border-white/20"
                        />
                    </div>

                    {/* Dropdown Menu */}
                    {isProfileMenuOpen && (
                        <div className="absolute right-0 mt-2 w-48 bg-green-900/95 border border-green-700 rounded-lg shadow-xl">
                            <button
                                onClick={signOut}
                                className="w-full px-4 py-3 text-left text-white font-orbitron hover:bg-green-800/50 rounded-lg transition-colors flex items-center gap-2"
                            >
                                <span className="material-symbols-outlined">logout</span>
                                Log Out
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* JAY CUP Trophy */}
            <div className="absolute bottom-8 right-8 z-40">
                <div 
                    className="flex flex-col items-center gap-2 cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => setIsJayCupModalOpen(true)}
                >
                    <span className="material-symbols-outlined text-[48px] text-yellow-400 animate-pulse">
                        emoji_events
                    </span>
                    <div className="font-orbitron text-white text-xl font-bold">JAY CUP</div>
                </div>
            </div>

            <div className="relative w-full max-w-[1000px] aspect-square flex items-center justify-center mx-auto">
                {/* Dark green circle */}
                <div className="absolute w-[50%] aspect-square rounded-full bg-green-900 z-0">
                    {/* Center icon */}
                    <TableCenterIcon size={480} opacity={0.4} />
                </div>
                <button
                    onClick={() => setIsModalOpen(true)}
                    className="relative z-10 px-12 py-6 bg-green-600 text-white rounded-xl font-orbitron 
                             shadow-lg transition-all flex items-center gap-3 text-2xl
                             hover:bg-green-700 hover:scale-105 hover:-translate-y-1"
                >
                    <span className="material-symbols-outlined text-3xl">playing_cards</span>
                    START A NEW GAME
                </button>
            </div>

            {/* JAY CUP Modal */}
            {isJayCupModalOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-green-900/95 border border-green-700 rounded-lg shadow-xl p-8 w-full max-w-md">
                        <div className="flex justify-between items-center mb-6">
                            <div className="flex items-center gap-3">
                                <span className="material-symbols-outlined text-yellow-400 text-3xl">emoji_events</span>
                                <h2 className="text-2xl font-orbitron text-white">JAY CUP Winners</h2>
                            </div>
                            <button 
                                onClick={() => setIsJayCupModalOpen(false)}
                                className="text-white/60 hover:text-white"
                            >
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>
                        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-4 custom-scrollbar">
                            {jayCupWinners.map((winner, index) => (
                                <div 
                                    key={index}
                                    className="flex justify-between items-center text-white font-orbitron p-3 rounded
                                             bg-green-800/30 border border-green-700/30 hover:bg-green-800/50 
                                             transition-colors"
                                >
                                    <span>{winner.name}</span>
                                    <span className="text-green-400">{winner.year}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            <GameSetupModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onStart={handleStartGame}
                user={user}
            />

            {/* Click outside handler for profile menu */}
            {isProfileMenuOpen && (
                <div 
                    className="fixed inset-0 z-30"
                    onClick={() => setIsProfileMenuOpen(false)}
                />
            )}
        </div>
    );
} 