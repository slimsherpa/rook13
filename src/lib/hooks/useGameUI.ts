import { useMemo } from 'react';
import { GameState, Seat } from '../types/game';

export function useGameUI(game: GameState | null) {
    const gameState = useMemo(() => {
        if (!game) return null;

        const currentPlayer = game.currentTurn ? game.players[game.currentTurn] : null;
        const isHumanTurn = currentPlayer?.type === 'human';
        const isHumanDealer = game.dealer ? game.players[game.dealer]?.type === 'human' : false;

        // Calculate UI states
        const canShowDealButton = 
            game.phase === 'dealing' && 
            game.currentTurn === game.dealer &&
            isHumanDealer;

        const canShowBiddingUI = 
            game.phase === 'bidding' && 
            isHumanTurn &&
            currentPlayer !== null;

        return {
            currentPlayer,
            isHumanTurn,
            isHumanDealer,
            canShowDealButton,
            canShowBiddingUI,
            phase: game.phase,
            currentTurn: game.currentTurn,
            dealer: game.dealer,
        };
    }, [game]);

    return gameState;
} 