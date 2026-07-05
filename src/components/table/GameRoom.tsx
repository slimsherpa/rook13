'use client';

// Top-level game screen: subscribes to the game and routes between the
// pre-game seat lobby, the live table, and error states. Also the reason
// closing your phone mid-game is fine — reopening this URL rejoins you at
// your seat with the full game state intact.
//
// Everyone must sign in (the Firestore rules require auth even to read), so
// a signed-out visitor following an invite link gets a sign-in prompt right
// here — the link is preserved and they land straight at the table after.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useGame } from '@/lib/hooks/useGame';
import SeatLobby from './SeatLobby';
import TableView from './TableView';
import LoadingPage from '@/components/LoadingPage';

export default function GameRoom({ gameId }: { gameId: string }) {
    const { user, loading: authLoading, signInWithGoogle } = useAuth();
    // don't subscribe until we know who's asking — unauthenticated reads are denied
    const { game, loading, error, mySeat, isHost, act, actionError } = useGame(user ? gameId : null);
    const router = useRouter();
    const [signingIn, setSigningIn] = useState(false);

    if (authLoading) {
        return <LoadingPage title="Rook13" subtitle="Joining table…" />;
    }

    if (!user) {
        return (
            <div className="min-h-dvh bg-green-800 flex flex-col items-center justify-center gap-5 px-6 text-center">
                <h1 className="font-orbitron text-4xl font-black text-white">
                    ROOK<span className="text-yellow-400">13</span>
                </h1>
                <p className="text-green-100/80 font-orbitron text-sm max-w-xs">
                    You&apos;ve been invited to a table! Sign in to take a seat or watch.
                </p>
                <button
                    onClick={async () => {
                        setSigningIn(true);
                        try { await signInWithGoogle(); } finally { setSigningIn(false); }
                    }}
                    disabled={signingIn}
                    className="px-8 py-3.5 rounded-xl bg-white text-green-900 font-orbitron font-bold shadow-lg hover:bg-green-50 disabled:opacity-60 flex items-center gap-3"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.032s2.701-6.032,6.033-6.032c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C7.021,2,2.543,6.477,2.543,12s4.478,10,10.002,10c8.396,0,10.249-7.85,9.426-11.748L12.545,10.239z"/>
                    </svg>
                    {signingIn ? 'Signing in…' : 'Sign in with Google'}
                </button>
            </div>
        );
    }

    if (loading) {
        return <LoadingPage title="Rook13" subtitle="Joining table…" />;
    }

    if (error || !game) {
        return (
            <div className="min-h-dvh bg-green-800 flex flex-col items-center justify-center gap-4 px-6 text-center">
                <span className="material-symbols-outlined text-white/50 text-6xl">playing_cards</span>
                <p className="text-white font-orbitron max-w-sm">{error || 'Game not found'}</p>
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
                actionError={actionError}
            />
        );
    }

    return <TableView game={game} mySeat={mySeat} act={act} actionError={actionError} />;
}
