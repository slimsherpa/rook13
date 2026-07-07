'use client';

// A quiet connectivity pill. Invisible while everything is healthy (the
// normal state); each condition gets a grace period so brief blips never
// flash UI at anyone.
//
//   "Reconnecting…" — the live listener is serving cached data (offline),
//                     so other players' moves are frozen until it recovers
//   "Syncing…"      — your own move is still on its way to the server
//                     (the table already shows it optimistically)

import { useEffect, useState } from 'react';

const OFFLINE_GRACE_MS = 2000;
const PENDING_GRACE_MS = 2500;

interface SyncStatusPillProps {
    synced: boolean;
    pendingCount: number;
}

export default function SyncStatusPill({ synced, pendingCount }: SyncStatusPillProps) {
    const [showOffline, setShowOffline] = useState(false);
    const [showPending, setShowPending] = useState(false);
    const hasPending = pendingCount > 0;

    useEffect(() => {
        if (synced) {
            setShowOffline(false);
            return;
        }
        const t = setTimeout(() => setShowOffline(true), OFFLINE_GRACE_MS);
        return () => clearTimeout(t);
    }, [synced]);

    useEffect(() => {
        if (!hasPending) {
            setShowPending(false);
            return;
        }
        const t = setTimeout(() => setShowPending(true), PENDING_GRACE_MS);
        return () => clearTimeout(t);
    }, [hasPending]);

    if (!showOffline && !showPending) return null;

    return (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
            <span
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full border font-orbitron text-[11px] shadow-lg backdrop-blur-sm ${
                    showOffline
                        ? 'bg-amber-950/90 border-amber-400/60 text-amber-200'
                        : 'bg-black/70 border-white/25 text-white/85'
                }`}
            >
                <span className={`w-2 h-2 rounded-full animate-pulse ${showOffline ? 'bg-amber-400' : 'bg-sky-400'}`} />
                {showOffline ? 'Reconnecting…' : 'Syncing…'}
            </span>
        </div>
    );
}
