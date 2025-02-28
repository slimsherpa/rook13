import { useState } from 'react';
import { User } from 'firebase/auth';

interface GameSetupModalProps {
    isOpen: boolean;
    onClose: () => void;
    onStart: (teamSetup: TeamSetup) => void;
    user: User;
}

export interface TeamSetup {
    teamA: {
        player1: string; // User's name or bot name
        player2: string; // Bot name
        isAllBots: boolean; // Flag to indicate if Player 1 is a bot
    };
    teamB: {
        player1: string; // Bot name
        player2: string; // Bot name
    };
}

const BOT_OPTIONS = {
    partner: 'Partner Bot',
    lefty: 'Lefty Bot',
    righty: 'Righty Bot',
    observer: 'Observer Bot'
};

export default function GameSetupModal({ isOpen, onClose, onStart, user }: GameSetupModalProps) {
    const [teamSetup, setTeamSetup] = useState<TeamSetup>({
        teamA: {
            player1: user.displayName || 'Player',
            player2: BOT_OPTIONS.partner,
            isAllBots: false
        },
        teamB: {
            player1: BOT_OPTIONS.lefty,
            player2: BOT_OPTIONS.righty
        }
    });

    if (!isOpen) return null;

    const handleStart = () => {
        onStart(teamSetup);
    };

    const handlePlayer1Change = (value: string) => {
        setTeamSetup(prev => ({
            ...prev,
            teamA: {
                ...prev.teamA,
                player1: value,
                isAllBots: value !== (user.displayName || 'Player')
            }
        }));
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-green-900/95 border border-green-700 rounded-lg shadow-xl p-8 w-full max-w-md transform transition-all">
                <h2 className="text-2xl font-orbitron text-white mb-6 text-center">Game Setup</h2>
                
                {/* Team A */}
                <div className="mb-8">
                    <h3 className="text-lg font-orbitron text-green-300 mb-4">Team A</h3>
                    <div className="space-y-4">
                        {/* Player 1 (User or Bot) - Dropdown */}
                        <div>
                            <label className="block text-sm font-medium text-green-300 mb-1">Player 1</label>
                            <select
                                value={teamSetup.teamA.player1}
                                onChange={(e) => handlePlayer1Change(e.target.value)}
                                className="w-full bg-green-800/50 border border-green-700 rounded px-3 py-2 text-white"
                            >
                                <option value={user.displayName || 'Player'}>
                                    {user.displayName || 'Player'} (You)
                                </option>
                                <option value={BOT_OPTIONS.observer}>{BOT_OPTIONS.observer}</option>
                            </select>
                            {teamSetup.teamA.isAllBots && (
                                <p className="mt-2 text-sm text-green-400">
                                    You will be observing an all-bot game
                                </p>
                            )}
                        </div>
                        
                        {/* Player 2 (Bot) - Dropdown */}
                        <div>
                            <label className="block text-sm font-medium text-green-300 mb-1">Player 2</label>
                            <select
                                value={teamSetup.teamA.player2}
                                onChange={(e) => setTeamSetup(prev => ({
                                    ...prev,
                                    teamA: { ...prev.teamA, player2: e.target.value }
                                }))}
                                className="w-full bg-green-800/50 border border-green-700 rounded px-3 py-2 text-white"
                            >
                                <option value={BOT_OPTIONS.partner}>{BOT_OPTIONS.partner}</option>
                                <option value={BOT_OPTIONS.lefty}>{BOT_OPTIONS.lefty}</option>
                                <option value={BOT_OPTIONS.righty}>{BOT_OPTIONS.righty}</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Team B */}
                <div className="mb-8">
                    <h3 className="text-lg font-orbitron text-green-300 mb-4">Team B</h3>
                    <div className="space-y-4">
                        {/* Player 1 (Bot) - Dropdown */}
                        <div>
                            <label className="block text-sm font-medium text-green-300 mb-1">Player 1</label>
                            <select
                                value={teamSetup.teamB.player1}
                                onChange={(e) => setTeamSetup(prev => ({
                                    ...prev,
                                    teamB: { ...prev.teamB, player1: e.target.value }
                                }))}
                                className="w-full bg-green-800/50 border border-green-700 rounded px-3 py-2 text-white"
                            >
                                <option value={BOT_OPTIONS.lefty}>{BOT_OPTIONS.lefty}</option>
                                <option value={BOT_OPTIONS.partner}>{BOT_OPTIONS.partner}</option>
                                <option value={BOT_OPTIONS.righty}>{BOT_OPTIONS.righty}</option>
                            </select>
                        </div>
                        
                        {/* Player 2 (Bot) - Dropdown */}
                        <div>
                            <label className="block text-sm font-medium text-green-300 mb-1">Player 2</label>
                            <select
                                value={teamSetup.teamB.player2}
                                onChange={(e) => setTeamSetup(prev => ({
                                    ...prev,
                                    teamB: { ...prev.teamB, player2: e.target.value }
                                }))}
                                className="w-full bg-green-800/50 border border-green-700 rounded px-3 py-2 text-white"
                            >
                                <option value={BOT_OPTIONS.righty}>{BOT_OPTIONS.righty}</option>
                                <option value={BOT_OPTIONS.partner}>{BOT_OPTIONS.partner}</option>
                                <option value={BOT_OPTIONS.lefty}>{BOT_OPTIONS.lefty}</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Buttons */}
                <div className="flex justify-end gap-4">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-white hover:text-green-300 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleStart}
                        className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white rounded-md transition-colors font-orbitron"
                    >
                        START GAME
                    </button>
                </div>
            </div>
        </div>
    );
} 