'use client';

// Game review at /review?id=<gameId>. Query-param routing keeps the app
// fully static-exportable for Firebase Hosting (same pattern as /game).

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import GameReview from '@/components/review/GameReview';
import LoadingPage from '@/components/LoadingPage';

function ReviewPageInner() {
    const params = useSearchParams();
    const router = useRouter();
    const raw = params.get('id') || '';
    const id = (decodeURIComponent(raw).match(/^[a-z0-9]+/) || [''])[0];

    if (!id) {
        router.push('/');
        return null;
    }

    return <GameReview gameId={id} />;
}

export default function ReviewPage() {
    return (
        <Suspense fallback={<LoadingPage title="Rook13" subtitle="Reading the archives…" />}>
            <ReviewPageInner />
        </Suspense>
    );
}
