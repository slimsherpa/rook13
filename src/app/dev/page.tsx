'use client';

// Dev sandbox: the full table UI running a local, in-memory game against
// bots — no sign-in, no Firestore. Handy for UI work and quick rule checks.
// Not linked from anywhere; visit /dev directly.
// Add ?spectate to view the table as a spectator (mySeat = null).

import { useEffect, useState } from 'react';
import { GameAction, GameDoc } from '@/lib/game/types';
import { createGameDoc, applyAction, InvalidActionError } from '@/lib/game/engine';
import { nextAgentActionAsync, preloadNets } from '@/lib/alpharook/agent';
import TableView from '@/components/table/TableView';

const freshGame = (spectate = false): GameDoc => {
    let g = createGameDoc({
        id: `dev-${Date.now()}`,
        joinCode: 'DEVX',
        host: { uid: 'dev-user', name: 'You' },
    });
    g = applyAction(g, { type: 'START_GAME' });
    if (spectate) {
        // all-bots game so the table plays itself while we watch
        // (swapped after START_GAME, which insists on one human);
        // seat a second champion so /dev?spectate doubles as a gen8 demo
        g = { ...g, seats: { ...g.seats, A1: { kind: 'bot', name: 'AlphaRook', botStyle: 'gen8' } } };
    }
    return g;
};

export default function DevTablePage() {
    const [game, setGame] = useState<GameDoc | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [spectate, setSpectate] = useState(false);

    useEffect(() => {
        const isSpectate = window.location.search.includes('spectate');
        setSpectate(isSpectate);
        setGame(freshGame(isSpectate));
    }, []);

    // local bot loop (async: neural seats may await their weight download)
    useEffect(() => {
        if (!game || game.status !== 'active') return;
        preloadNets(game);
        let cancelled = false;
        let t: ReturnType<typeof setTimeout> | null = null;
        (async () => {
            const action = await nextAgentActionAsync(game);
            if (cancelled || !action) return;
            // leading a new trick waits out the previous trick's linger + sweep
            const leadsNextTrick =
                action.type === 'PLAY_CARD' &&
                game.trickPlays.length === 0 &&
                game.completedTricks.length > 0;
            const delay = action.type === 'ACK_REDEAL' ? 4000 : leadsNextTrick ? 3200 : 900;
            t = setTimeout(() => {
                setGame((g) => {
                    if (!g) return g;
                    try {
                        return applyAction(g, action);
                    } catch {
                        return g;
                    }
                });
            }, delay);
        })();
        return () => {
            cancelled = true;
            if (t) clearTimeout(t);
        };
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

    const mySeat = spectate ? null : 'A1';

    if (game.status === 'completed') {
        // TableView renders the game-over overlay; give it a restart too
        return (
            <div className="relative">
                <TableView game={game} mySeat={mySeat} act={act} actionError={actionError} />
                <button
                    onClick={() => setGame(freshGame(spectate))}
                    className="fixed top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-yellow-500 text-navy-950 font-orbitron text-xs font-bold"
                >
                    New Dev Game
                </button>
            </div>
        );
    }

    return <TableView game={game} mySeat={mySeat} act={act} actionError={actionError} />;
}
