'use client';

// "Report a Blunder" — the AI-training feedback loop, in AlphaRook's signature
// hot pink. Lives inside the hand recap and the game review, wrapped around
// one hand at a time:
//
//   1. Tap the pink Report button → the hand arms: every flaggable action
//      (each bid, the go-down, the trump call, every card played) lights up
//      with a pink ring.
//   2. Tap the action that was the mistake → a confirm sheet shows exactly
//      what you picked and asks (optionally) what the better move was.
//   3. Confirm → the report lands in games/{id}/blunders for the training
//      queue, and the action wears a little pink flag in the review so
//      everyone can see it's been called out.
//
// Anyone who can see the game — seated or just watching — can report.

import {
    createContext, useContext, useEffect, useRef, useState, ReactNode,
} from 'react';
import { GameDoc, Seat, Suit } from '@/lib/game/types';
import { BlunderTarget, describeTarget, targetKey } from '@/lib/game/blunders';
import {
    BlunderDoc, retractBlunder, submitBlunder, subscribeBlunders,
} from '@/lib/firebase/blunderService';
import { useAuth } from '@/lib/hooks/useAuth';
import { ASSIST_PINK } from '@/components/table/AssistDial';
import PlayingCard from '@/components/ui/PlayingCard';

type Seats = GameDoc['seats'];

// Classes the review components put on flaggable elements. Kept here so the
// pink language stays in one place.
/** armed: this element is tappable as a blunder right now */
export const blunderArmedClass =
    'cursor-pointer ring-2 ring-[#ff2d95]/60 hover:ring-[#ff2d95] hover:shadow-[0_0_12px_rgba(255,45,149,0.55)] transition';
/** flagged: someone already reported this action */
export const blunderFlaggedClass = 'ring-2 ring-[#ff2d95]';

/** The little pink flag an already-reported action wears. Parent must be
 *  `relative`. */
export const BlunderFlag = () => (
    <span
        className="absolute -top-1.5 -right-1.5 z-10 w-4 h-4 rounded-full flex items-center justify-center shadow-md pointer-events-none"
        style={{ backgroundColor: ASSIST_PINK }}
        title="Reported as a blunder"
    >
        <span className="material-symbols-outlined text-white" style={{ fontSize: 11 }}>flag</span>
    </span>
);

interface BlunderCtxValue {
    /** selection mode is on — flaggable elements should light up and call pick() */
    armed: boolean;
    pick: (t: BlunderTarget) => void;
    /** targetKey()s already reported for this hand */
    reportedKeys: Set<string>;
    // internals for the trigger UI
    arm: () => void;
    disarm: () => void;
    reports: BlunderDoc[];
    myUid: string | null;
    gameId: string;
}

const BlunderCtx = createContext<BlunderCtxValue | null>(null);

/** Null outside a BlunderProvider — review components render normally then. */
export const useBlunderMode = () => useContext(BlunderCtx);

interface BlunderProviderProps {
    gameId: string;
    seats: Seats;
    handNumber: number;
    trump: Suit | null;
    children: ReactNode;
}

const firstName = (seats: Seats, seat: Seat) => seats[seat].name.split(' ')[0];

/** Wraps one hand's review. Renders the confirm sheet and the thank-you toast
 *  on top of its children; the trigger button goes wherever <BlunderTrigger/>
 *  is placed inside. */
export function BlunderProvider({ gameId, seats, handNumber, trump, children }: BlunderProviderProps) {
    const { user } = useAuth();
    const [armed, setArmed] = useState(false);
    const [pending, setPending] = useState<BlunderTarget | null>(null);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [sent, setSent] = useState(false);
    const [allReports, setAllReports] = useState<BlunderDoc[]>([]);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => subscribeBlunders(gameId, setAllReports), [gameId]);
    useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

    const reports = allReports.filter((r) => r.handNumber === handNumber);
    const reportedKeys = new Set(reports.map((r) => targetKey(r.target)));

    const pick = (t: BlunderTarget) => {
        setPending(t);
        setReason('');
        setSubmitError(null);
    };

    const cancelPick = () => setPending(null);

    const confirm = async () => {
        if (!pending || !user) return;
        setBusy(true);
        setSubmitError(null);
        try {
            await submitBlunder({
                gameId,
                handNumber,
                target: pending,
                seatName: firstName(seats, pending.seat),
                seatIsBot: seats[pending.seat].kind === 'bot',
                reporter: { uid: user.uid, name: user.displayName?.split(' ')[0] ?? 'Player' },
                reason: reason.trim(),
            });
            setPending(null);
            setArmed(false);
            setSent(true);
            if (toastTimer.current) clearTimeout(toastTimer.current);
            toastTimer.current = setTimeout(() => setSent(false), 3500);
        } catch (e: any) {
            setSubmitError(e?.message || 'Could not save the report — try again.');
        } finally {
            setBusy(false);
        }
    };

    const ctx: BlunderCtxValue = {
        armed,
        pick,
        reportedKeys,
        arm: () => setArmed(true),
        disarm: () => setArmed(false),
        reports,
        myUid: user?.uid ?? null,
        gameId,
    };

    // what the confirm sheet shows for the picked action
    const pendingVisual = (t: BlunderTarget) => {
        switch (t.kind) {
            case 'bid':
                return (
                    <span className="px-2.5 py-1 rounded-lg bg-sky-800 text-sky-200 font-orbitron font-bold text-sm">
                        {t.bid === 'pass' ? 'PASS' : t.bid}
                    </span>
                );
            case 'trump':
                return (
                    <span className={`px-2.5 py-1 rounded-lg font-orbitron font-bold text-sm text-white ${
                        { Red: 'bg-red-600', Yellow: 'bg-yellow-500', Black: 'bg-gray-900', Green: 'bg-green-600' }[t.suit]
                    }`}>
                        {t.suit.toUpperCase()} TRUMP
                    </span>
                );
            case 'godown':
                return (
                    <div className="flex -space-x-3">
                        {t.cards.map((c) => (
                            <PlayingCard key={`${c.suit}-${c.number}`} card={c} trump={trump} size="sm" />
                        ))}
                    </div>
                );
            case 'play':
                return <PlayingCard card={t.card} trump={trump} size="sm" />;
        }
    };

    return (
        <BlunderCtx.Provider value={ctx}>
            {children}

            {/* confirm sheet */}
            {pending && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div
                        className="bg-navy-950 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border-2"
                        style={{ borderColor: ASSIST_PINK }}
                    >
                        <div className="px-5 py-3 flex items-center gap-2" style={{ backgroundColor: `${ASSIST_PINK}26` }}>
                            <span className="material-symbols-outlined" style={{ color: ASSIST_PINK }}>flag</span>
                            <span className="font-orbitron font-bold text-sm" style={{ color: ASSIST_PINK }}>
                                REPORT THIS BLUNDER?
                            </span>
                        </div>

                        <div className="px-5 py-4 space-y-3.5">
                            <p className="text-white font-orbitron text-sm leading-relaxed">
                                Hand {handNumber} — {describeTarget(pending, firstName(seats, pending.seat))}
                                {seats[pending.seat].kind === 'bot' && (
                                    <span className="text-white/50 text-xs"> (AI)</span>
                                )}
                            </p>
                            <div className="flex justify-center py-1">{pendingVisual(pending)}</div>

                            <textarea
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                maxLength={500}
                                rows={3}
                                placeholder="What was the better move? (optional, but it helps the training)"
                                className="w-full rounded-xl bg-white/5 border border-white/15 text-white text-sm p-3 placeholder:text-white/35 focus:outline-none resize-none"
                                style={{ caretColor: ASSIST_PINK }}
                                onFocus={(e) => { e.currentTarget.style.borderColor = ASSIST_PINK; }}
                                onBlur={(e) => { e.currentTarget.style.borderColor = ''; }}
                            />

                            <p className="text-white/45 text-[11px] leading-snug">
                                Saved with the full hand history so AlphaRook can study exactly what went wrong.
                            </p>
                            {!user && (
                                <p className="text-yellow-300/90 text-xs font-orbitron">Sign in to send reports.</p>
                            )}
                            {submitError && (
                                <p className="text-red-300 text-xs font-orbitron">{submitError}</p>
                            )}
                        </div>

                        <div className="flex gap-2 px-5 pb-4">
                            <button
                                onClick={cancelPick}
                                disabled={busy}
                                className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-orbitron text-sm"
                            >
                                Back
                            </button>
                            <button
                                onClick={confirm}
                                disabled={busy || !user}
                                className="flex-[2] py-2.5 rounded-xl text-white font-orbitron text-sm font-bold active:scale-95 transition disabled:opacity-60"
                                style={{ backgroundColor: ASSIST_PINK }}
                            >
                                {busy ? 'Reporting…' : '🚩 Report Blunder'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* thank-you toast */}
            {sent && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-2 animate-card-reveal"
                    style={{ backgroundColor: ASSIST_PINK }}
                >
                    <span className="material-symbols-outlined text-white text-lg">flag</span>
                    <span className="text-white font-orbitron text-sm font-bold">
                        Blunder logged — AlphaRook thanks you!
                    </span>
                </div>
            )}
        </BlunderCtx.Provider>
    );
}

/** The pink entry point + the hand's existing reports. Place inside a
 *  BlunderProvider, above the deal breakdown. */
export function BlunderTrigger() {
    const ctx = useContext(BlunderCtx);
    if (!ctx) return null;
    const { armed, arm, disarm, reports, myUid, gameId } = ctx;

    return (
        // armed: the wrapper itself goes sticky (and the reports list hides) so
        // the instructions stay visible while scrolling the hand for the mistake
        <div className={armed ? 'sticky top-0 z-20' : 'space-y-2'}>
            {armed ? (
                <div
                    className="rounded-xl px-3.5 py-2.5 flex items-center gap-3 shadow-lg"
                    style={{ backgroundColor: ASSIST_PINK }}
                >
                    <span className="material-symbols-outlined text-white">touch_app</span>
                    <div className="flex-1 min-w-0">
                        <div className="text-white font-orbitron text-xs font-bold uppercase tracking-wide">
                            Tap the blunder
                        </div>
                        <div className="text-white/85 text-[11px] leading-snug">
                            Any bid, the go-down, the trump call, or a played card.
                        </div>
                    </div>
                    <button
                        onClick={disarm}
                        className="px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white font-orbitron text-xs flex-shrink-0"
                    >
                        Cancel
                    </button>
                </div>
            ) : (
                <button
                    onClick={arm}
                    className="w-full py-2.5 rounded-xl border-2 font-orbitron text-xs font-bold uppercase tracking-wide flex items-center justify-center gap-2 transition hover:shadow-[0_0_14px_rgba(255,45,149,0.4)]"
                    style={{ borderColor: `${ASSIST_PINK}99`, color: ASSIST_PINK }}
                >
                    <span className="material-symbols-outlined text-base">flag</span>
                    Report an AI Blunder
                </button>
            )}

            {/* what's already been called out this hand */}
            {!armed && reports.length > 0 && (
                <div
                    className="rounded-xl border px-3 py-2.5 space-y-1.5"
                    style={{ borderColor: `${ASSIST_PINK}55`, backgroundColor: `${ASSIST_PINK}14` }}
                >
                    <div className="font-orbitron text-[10px] uppercase tracking-widest font-bold" style={{ color: ASSIST_PINK }}>
                        🚩 Reported blunders ({reports.length})
                    </div>
                    {reports.map((r) => (
                        <div key={r.id} className="flex items-start gap-2">
                            <div className="flex-1 min-w-0 text-[11px] leading-snug text-white/85">
                                <span className="font-bold text-white">{r.reporter.name}</span>
                                {' flagged '}
                                {describeTarget(r.target, r.seatName)}
                                {r.seatIsBot ? ' (AI)' : ''}
                                {r.reason && (
                                    <span className="text-white/60 italic"> — “{r.reason}”</span>
                                )}
                            </div>
                            {r.reporter.uid === myUid && (
                                <button
                                    onClick={() => retractBlunder(gameId, r.id)}
                                    title="Remove my report"
                                    className="text-white/40 hover:text-white flex-shrink-0"
                                >
                                    <span className="material-symbols-outlined text-sm">close</span>
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
