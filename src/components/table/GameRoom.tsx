'use client';

// Top-level game screen: subscribes to the game and routes between the
// pre-game seat lobby, the live table, and error states. Also the reason
// closing your phone mid-game is fine — reopening this URL rejoins you at
// your seat with the full game state intact.

import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useGame } from '@/lib/hooks/useGame';
import SeatLobby from './SeatLobby';
import TableView from './TableView';
import LoadingPage from '@/components/LoadingPage';

export default function GameRoom({ gameId }: { gameId: string }) {
    const { user, loading: authLoading } = useAuth();
    const { game, loading, error, mySeat, isHost, act, actionError } = useGame(gameId);
    const router = useRouter();

    if (authLoading || loading) {
        return <LoadingPage title="Rook13" subtitle="Joining table…" />;
    }

    if (!user) {
        router.push('/');
        return null;
    }

    if (error || !game) {
        return (
            <div className="min-h-dvh bg-green-800 flex flex-col items-center justify-center gap-4 px-6 text-center">
                <span className="material-symbols-outlined text-white/50 text-6xl">playing_cards</span>
                <p className="text-white font-orbitron">{error || 'Game not found'}</p>
                <button
                    onClick={() => router.push('/')}
                    className="px-6 py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-orbitron text-sm"
                >
                    Back to Lobby
                </button>
            </div>
        );
    }

    if (game.status === 'lobby') {
        return (
            <SeatLobby
                game={game}
                myUid={user.uid}
                myName={user.displayName || 'Player'}
                myPhotoURL={user.photoURL || undefined}
                isHost={isHost}
                act={act}
            />
        );
    }

    return <TableView game={game} mySeat={mySeat} act={act} actionError={actionError} />;
}
