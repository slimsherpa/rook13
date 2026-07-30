// The Cloud Run bot service (service/): heavyweight brains — the teacher
// (gen21 + K24 search) and AlphaGodRook — decide server-side. Clients just
// nudge it when they see a SERVER_STYLES bot's turn; the service verifies
// the truth in Firestore and writes the move through the same
// optimistic-concurrency transaction the clients use, so a duplicate or
// malicious nudge can never corrupt a game. Fire-and-forget: if the
// service is down, useGame's 20s local cover keeps the table moving.

export const BOT_SERVICE_URL =
    process.env.NEXT_PUBLIC_BOT_SERVICE_URL ?? 'https://rook13-bots-3ytxfwifyq-uc.a.run.app';

const nudged = new Map<string, number>(); // gameId -> last actionCount nudged

// When the service is unreachable (not deployed public yet, offline, …)
// the local cover shouldn't sit out its full 20s grace on every move —
// remember recent failures so useGame can fall back to normal pacing,
// and let the UI show a "cloud bots offline" indicator.
let unhealthyUntil = 0;
const healthListeners = new Set<() => void>();
const notifyHealth = () => healthListeners.forEach((l) => l());
export const botServiceHealthy = (): boolean => Date.now() >= unhealthyUntil;
export const subscribeBotServiceHealth = (l: () => void): (() => void) => {
    healthListeners.add(l);
    return () => { healthListeners.delete(l); };
};
const markUnhealthy = () => {
    const was = botServiceHealthy();
    unhealthyUntil = Date.now() + 60_000;
    if (was) notifyHealth();
};

export const nudgeBotService = (gameId: string, actionCount: number): void => {
    if (nudged.get(gameId) === actionCount) return;
    nudged.set(gameId, actionCount);
    fetch(`${BOT_SERVICE_URL}/nudge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId }),
        keepalive: true,
    }).then((res) => {
        if (!res.ok) markUnhealthy();
        else if (unhealthyUntil !== 0) { unhealthyUntil = 0; notifyHealth(); }
    }).catch(markUnhealthy);
};
