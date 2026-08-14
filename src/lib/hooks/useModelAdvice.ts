'use client';

// The AI-assistant data hook: when assist mode is on and it's this seat's
// decision, load the latest brain (gen26 — the Gardner-style reflex) and
// compute the model's pick-likelihood over the current options. Recomputes
// only when the decision context actually changes (phase, whose turn, hand,
// cards on the table, go-down selection), so the dials are cheap.
//
// SUPER-TRAINER (deep=true): card decisions additionally ask the cloud to
// DayDream — the same imagined-deal search the thinking bots run. The
// reflex dials render immediately (the UI blurs them while deepPending),
// then sharpen into the searched values when the cloud answers. The fetch
// is cancelled the moment the decision fingerprint moves (you played, or
// the table did), and any failure just leaves the reflex dials standing.

import { useEffect, useState } from 'react';
import { GameDoc, Seat } from '@/lib/game/types';
import { loadQNet } from '@/lib/alpharook/qnet';
import { AdviceMap, modelAdvice, deepAdvice } from '@/lib/alpharook/advice';
import { legalCards } from '@/lib/game/engine';
import { cardToInt } from '@/lib/alpharook/encoder';
import { BOT_SERVICE_URL, botServiceHeaders } from '@/lib/botService';

const EMPTY: AdviceMap = new Map();

// opening leads can genuinely take tens of seconds of cloud think
// (measured: p90 ~20s); past this we stop blurring and keep the reflex
const DEEP_TIMEOUT_MS = 45_000;

export interface ModelAdviceState {
    advice: AdviceMap;
    /** deep advice requested and still thinking — blur the dials */
    deepPending: boolean;
    /** the dials currently showing are the searched (DayDream) values */
    deepApplied: boolean;
}

export function useModelAdvice(
    game: GameDoc, mySeat: Seat | null, enabled: boolean, deep = false,
): ModelAdviceState {
    const [state, setState] = useState<ModelAdviceState>({
        advice: EMPTY, deepPending: false, deepApplied: false,
    });

    // a decision "fingerprint": recompute only when one of these moves
    const myTurn = mySeat !== null && game.turn === mySeat;
    const iAmBidWinner = mySeat !== null && game.bidWinner === mySeat;
    const relevant =
        (game.phase === 'bidding' && myTurn) ||
        (game.phase === 'trump' && iAmBidWinner) ||
        (game.phase === 'widow' && iAmBidWinner) ||
        (game.phase === 'playing' && myTurn);
    const fp = `${game.phase}:${game.handNumber}:${game.turn}:${game.trickPlays.length}:${game.highBid}`;

    useEffect(() => {
        if (!enabled || !mySeat || !relevant) {
            setState({ advice: EMPTY, deepPending: false, deepApplied: false });
            return;
        }
        let cancelled = false;
        const wantDeep = deep && game.phase === 'playing'
            && legalCards(game, mySeat).length > 1;
        loadQNet('gen26')
            .then((net) => {
                if (cancelled) return;
                try {
                    setState({
                        advice: modelAdvice(game, mySeat, net),
                        deepPending: wantDeep, deepApplied: false,
                    });
                } catch {
                    setState({ advice: EMPTY, deepPending: false, deepApplied: false });
                    return;
                }
            })
            .catch(() => {
                if (!cancelled) setState({ advice: EMPTY, deepPending: false, deepApplied: false });
            });

        let timeout: ReturnType<typeof setTimeout> | null = null;
        const ctrl = new AbortController();
        if (wantDeep) {
            timeout = setTimeout(() => ctrl.abort(), DEEP_TIMEOUT_MS);
            (async () => {
                const res = await fetch(`${BOT_SERVICE_URL}/advise`, {
                    method: 'POST',
                    headers: await botServiceHeaders(),
                    body: JSON.stringify({ gameId: game.id }),
                    signal: ctrl.signal,
                });
                if (!res.ok) throw new Error(String(res.status));
                const d = await res.json();
                if (cancelled) return;
                if (d.deep) {
                    const legal = legalCards(game, mySeat).map(cardToInt);
                    console.info(`✨ super-trainer: DayDream sharpened ${d.cands.length} dials`
                        + (d.think ? ` (k=${d.think.k}, ${d.think.secs}s${d.overrode ? ', overrode instinct' : ''})` : ''));
                    setState({
                        advice: deepAdvice(legal, d.cands, d.values),
                        deepPending: false,
                        deepApplied: true,
                    });
                } else {
                    setState((s) => ({ ...s, deepPending: false }));
                }
            })().catch(() => {
                // cloud unreachable / aborted / quota: the reflex dials stand
                if (!cancelled) {
                    console.info('✨ super-trainer: cloud unavailable — instinct dials stand');
                    setState((s) => ({ ...s, deepPending: false }));
                }
            });
        }
        return () => {
            cancelled = true;
            ctrl.abort();
            if (timeout) clearTimeout(timeout);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, deep, mySeat, relevant, fp]);

    return state;
}
