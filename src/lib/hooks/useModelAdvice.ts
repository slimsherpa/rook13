'use client';

// The AI-assistant data hook: when assist mode is on and it's this seat's
// decision, load the latest brain (gen13 weights = the gen16 reflex) and
// compute the model's pick-likelihood over the current options. Recomputes
// only when the decision context actually changes (phase, whose turn, hand,
// cards on the table, go-down selection), so the dials are cheap.

import { useEffect, useState } from 'react';
import { GameDoc, Seat } from '@/lib/game/types';
import { loadQNet } from '@/lib/alpharook/qnet';
import { AdviceMap, modelAdvice } from '@/lib/alpharook/advice';

const EMPTY: AdviceMap = new Map();

export function useModelAdvice(game: GameDoc, mySeat: Seat | null, enabled: boolean): AdviceMap {
    const [advice, setAdvice] = useState<AdviceMap>(EMPTY);

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
            setAdvice(EMPTY);
            return;
        }
        let cancelled = false;
        loadQNet('gen13')
            .then((net) => {
                if (cancelled) return;
                try {
                    setAdvice(modelAdvice(game, mySeat, net));
                } catch {
                    setAdvice(EMPTY);
                }
            })
            .catch(() => { if (!cancelled) setAdvice(EMPTY); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, mySeat, relevant, fp]);

    return advice;
}
