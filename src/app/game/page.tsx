'use client';

// Game room at /game?id=<gameId>. Query-param routing keeps the app fully
// static-exportable for Firebase Hosting (no dynamic route segments).

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import GameRoom from '@/components/table/GameRoom';
import LoadingPage from '@/components/LoadingPage';

function GamePageInner() {
    const params = useSearchParams();
    const router = useRouter();
    const id = params.get('id');

    if (!id) {
        router.push('/');
        return null;
    }

    return <GameRoom gameId={id} />;
}

export default function GamePage() {
    return (
        <Suspense fallback={<LoadingPage title="Rook13" subtitle="Joining table…" />}>
            <GamePageInner />
        </Suspense>
    );
}
