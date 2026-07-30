'use client';

// Table talk: a small chat button that opens a tray of one-tap quick
// messages (plus a short free-text line), and speech bubbles that pop up
// next to the talker's badge for a few seconds — then fade, exactly like
// the classics. Every message is stored forever in games/{id}/chat (the
// anti-signaling audit log); the bubble is just the theater.

import { useEffect, useRef, useState } from 'react';
import { GameDoc, Seat } from '@/lib/game/types';
import { positionsFor } from './layout';
import {
    ChatMessage, QUICK_MESSAGES, TABLE_MSG_MAX, sendTableMessage, subscribeTableChat,
} from '@/lib/firebase/chatService';
import { useAuth } from '@/lib/hooks/useAuth';

const BUBBLE_MS = 6000;

interface TableChatProps {
    game: GameDoc;
    mySeat: Seat | null;
    bottomSeat: Seat;
}

export default function TableChat({ game, mySeat, bottomSeat }: TableChatProps) {
    const { user } = useAuth();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState('');
    const [log, setLog] = useState<ChatMessage[]>([]);
    const [bubbles, setBubbles] = useState<ChatMessage[]>([]);
    const seen = useRef<Set<string>>(new Set());
    const mountedAt = useRef(Date.now());

    useEffect(() => subscribeTableChat(game.id, setLog), [game.id]);

    // new messages become bubbles for a few seconds; history stays in the tray
    useEffect(() => {
        for (const m of log) {
            if (seen.current.has(m.id)) continue;
            seen.current.add(m.id);
            if (m.at < mountedAt.current - 3000) continue; // pre-join history
            setBubbles((b) => [...b.filter((x) => x.id !== m.id), m]);
            setTimeout(() => setBubbles((b) => b.filter((x) => x.id !== m.id)), BUBBLE_MS);
        }
    }, [log]);

    if (!user) return null;

    const me = { uid: user.uid, name: user.displayName || 'Player' };
    const send = (text: string) => {
        sendTableMessage(game.id, me, text, mySeat).catch(() => {});
        setDraft('');
        setOpen(false);
    };

    // where a seat's bubble lives, relative to the table (badge slots)
    const pos = positionsFor(bottomSeat);
    const slotClass = (seat: Seat | undefined): string => {
        if (seat === pos.top) return 'top-16 left-1/2 -translate-x-1/2';
        if (seat === pos.left) return 'left-3 top-[34%]';
        if (seat === pos.right) return 'right-3 top-[34%]';
        if (seat === pos.bottom) return 'bottom-28 left-1/2 -translate-x-1/2';
        return 'top-12 left-1/2 -translate-x-1/2'; // spectators: under the header
    };

    return (
        <>
            {/* speech bubbles */}
            {bubbles.map((m) => (
                <div
                    key={m.id}
                    className={`absolute z-30 pointer-events-none animate-card-reveal max-w-[70%] ${slotClass(m.seat)}`}
                >
                    <div className="rounded-2xl bg-white text-navy-950 px-3 py-1.5 shadow-xl border border-black/10">
                        <span className="block text-[10px] font-orbitron font-bold text-navy-950/60 leading-tight">
                            {m.name.split(' ')[0]}
                        </span>
                        <span className="block text-[13px] leading-snug break-words">{m.text}</span>
                    </div>
                </div>
            ))}

            {/* chat button — bottom-left, out of the hand's way */}
            <button
                onClick={() => setOpen((o) => !o)}
                className="absolute bottom-16 left-3 z-20 w-10 h-10 rounded-full bg-black/50 border border-white/20 text-white/80 hover:text-white flex items-center justify-center"
                title="Table talk"
            >
                <span className="material-symbols-outlined text-xl">chat_bubble</span>
            </button>

            {/* tray */}
            {open && (
                <>
                    <div className="absolute inset-0 z-30" onClick={() => setOpen(false)} />
                    <div className="absolute bottom-28 left-3 right-3 sm:right-auto sm:w-80 z-40 rounded-2xl bg-navy-950/95 border border-white/20 shadow-2xl p-3">
                        {/* recent talk (the tray shows what the bubbles said) */}
                        {log.length > 0 && (
                            <div className="max-h-28 overflow-y-auto mb-2 space-y-1">
                                {log.slice(-8).map((m) => (
                                    <div key={m.id} className="text-[12px] leading-snug">
                                        <span className="font-orbitron font-bold text-sky-300 text-[10px]">{m.name.split(' ')[0]} </span>
                                        <span className="text-white/80">{m.text}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-1.5 mb-2">
                            {QUICK_MESSAGES.map((q) => (
                                <button
                                    key={q}
                                    onClick={() => send(q)}
                                    className="rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs py-2 px-2 text-left"
                                >
                                    {q}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-1.5">
                            <input
                                value={draft}
                                onChange={(e) => setDraft(e.target.value.slice(0, TABLE_MSG_MAX))}
                                onKeyDown={(e) => e.key === 'Enter' && draft.trim() && send(draft)}
                                placeholder={`Say something… (${TABLE_MSG_MAX} max)`}
                                className="flex-1 min-w-0 rounded-lg bg-navy-900 border border-white/15 px-3 py-2 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-sky-400"
                            />
                            <button
                                onClick={() => draft.trim() && send(draft)}
                                disabled={!draft.trim()}
                                className="px-3 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white font-orbitron text-xs font-bold"
                            >
                                SEND
                            </button>
                        </div>
                    </div>
                </>
            )}
        </>
    );
}
