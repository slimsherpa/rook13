'use client';

// Dev sandbox: the full table UI running a local, in-memory game against
// bots — no sign-in, no Firestore. Handy for UI work and quick rule checks.
// Not linked from anywhere; visit /dev directly.

import { useEffect, useState } from 'react';
import { GameAction, GameDoc } from '@/lib/game/types';
import { createGameDoc, applyAction, InvalidActionError } from '@/lib/game/engine';
import { nextBotAction } from '@/lib/game/bots';
import TableView from '@/components/table/TableView';

const freshGame = (): GameDoc => {
    let g = createGameDoc({
        id: `dev-${Date.now()}`,
        joinCode: 'DEVX',
        host: { uid: 'dev-user', name: 'You' },
    });
    g = applyAction(g, { type: 'START_GAME' });
    return g;
};

export default function DevTablePage() {
    const [game, setGame] = useState<GameDoc | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);

    useEffect(() => setGame(freshGame()), []);

    // local bot loop
    useEffect(() => {
        if (!game || game.status !== 'active') return;
        const action = nextBotAction(game);
        if (!action) return;
        const delay = action.type === 'ACK_REDEAL' ? 4000 : 900;
        const t = setTimeout(() => {
            setGame((g) => {
                if (!g) return g;
                try {
                    return applyAction(g, action);
                } catch {
                    return g;
                }
            });
        }, delay);
        return () => clearTimeout(t);
    }, [game]);

    if (!game) return null;

    const act = async (action: GameAction) => {
        setGame((g) => {
            if (!g) return g;
            try {
                const next = applyAction(g, action);
                setActionError(null);
                return next;
            } catch (e) {
                if (e instanceof InvalidActionError) setActionError(e.message);
                return g;
            }
        });
    };

    if (game.status === 'completed') {
        // TableView renders the game-over overlay; give it a restart too
        return (
            <div className="relative">
                <TableView game={game} mySeat="A1" act={act} actionError={actionError} />
                <button
                    onClick={() => setGame(freshGame())}
                    className="fixed top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-yellow-500 text-green-950 font-orbitron text-xs font-bold"
                >
                    New Dev Game
                </button>
            </div>
        );
    }

    return <TableView game={game} mySeat="A1" act={act} actionError={actionError} />;
}
