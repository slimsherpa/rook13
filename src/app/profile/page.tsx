'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { getUserProfile, UserProfile } from '@/lib/firebase/userService';
import LoadingPage from '@/components/LoadingPage';

export default function ProfilePage() {
    const { user, loading } = useAuth();
    const router = useRouter();
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [fetched, setFetched] = useState(false);

    useEffect(() => {
        if (!loading && !user) router.push('/');
    }, [user, loading, router]);

    useEffect(() => {
        if (!user) return;
        getUserProfile(user.uid)
            .then(setProfile)
            .finally(() => setFetched(true));
    }, [user]);

    if (loading || !user || !fetched) {
        return <LoadingPage title="Rook13" subtitle="Loading profile…" />;
    }

    const s = profile?.stats;
    const winRate = s && s.gamesPlayed > 0 ? Math.round((s.gamesWon / s.gamesPlayed) * 100) : 0;
    const bidRate = s && s.bidsWon > 0 ? Math.round((s.bidsMade / s.bidsWon) * 100) : 0;

    const stat = (label: string, value: string | number, accent = false) => (
        <div className="rounded-xl bg-green-900/50 border border-green-700/50 p-4 text-center">
            <div className={`font-orbitron text-2xl font-bold ${accent ? 'text-yellow-400' : 'text-white'}`}>{value}</div>
            <div className="text-green-100/60 text-[11px] font-orbitron uppercase tracking-wide mt-1">{label}</div>
        </div>
    );

    return (
        <div className="min-h-dvh bg-green-800">
            <div className="max-w-md mx-auto px-4 py-5">
                <div className="flex items-center justify-between mb-6">
                    <button onClick={() => router.push('/')} className="text-white/70 hover:text-white flex items-center gap-1 font-orbitron text-sm">
                        <span className="material-symbols-outlined">arrow_back</span> Lobby
                    </button>
                    <span className="font-orbitron font-bold text-white">ROOK<span className="text-yellow-400">13</span></span>
                </div>

                <div className="flex flex-col items-center mb-8">
                    {user.photoURL ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={user.photoURL} alt="" className="w-20 h-20 rounded-full border-4 border-white/20" referrerPolicy="no-referrer" />
                    ) : (
                        <div className="w-20 h-20 rounded-full bg-green-950 border-4 border-white/20 flex items-center justify-center text-white font-orbitron text-3xl">
                            {(user.displayName || 'P').charAt(0)}
                        </div>
                    )}
                    <h1 className="font-orbitron text-white text-xl font-bold mt-3">{user.displayName}</h1>
                </div>

                {!s || s.gamesPlayed === 0 ? (
                    <div className="text-center text-green-100/60 font-orbitron text-sm py-8">
                        No finished games yet — go play a hand!
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-3 gap-3">
                            {stat('Games', s.gamesPlayed)}
                            {stat('Wins', s.gamesWon)}
                            {stat('Win Rate', `${winRate}%`, true)}
                        </div>
                        <div className="grid grid-cols-3 gap-3 mt-3">
                            {stat('Hands', s.handsPlayed)}
                            {stat('Bids Won', s.bidsWon)}
                            {stat('Times Set', s.timesSet)}
                        </div>
                        <div className="grid grid-cols-2 gap-3 mt-3">
                            {stat('Bid Success', s.bidsWon > 0 ? `${bidRate}%` : '—')}
                            {stat('Best Bid Made', s.highestBidMade || '—', true)}
                        </div>
                        {s.redealsWitnessed > 0 && (
                            <div className="mt-3">
                                {stat('Legendary Misdeals Witnessed', s.redealsWitnessed, true)}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
