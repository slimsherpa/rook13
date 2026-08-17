// The lobby ladder — StarCraft-style tiers for the family, sitting on the
// margin-aware Elo in skill.ts. Tier floors are calibrated to the bot
// anchors: a few placement wins over mid bots reaches Gold, farming easy
// bots plateaus below Platinum, and the top tiers demand trading even (or
// better) with Cosmo. GrandMaster is additionally seat-capped like the
// SC2 GM ladder — see gmSeatCount below.

export interface RankTier {
    key: string;
    name: string;
    emoji: string;
    /** tailwind text color for the tier */
    color: string;
    /** tailwind background color for progress bars */
    bar: string;
    /** rating floor */
    min: number;
}

export const RANK_TIERS: RankTier[] = [
    { key: 'bronze', name: 'Bronze', emoji: '🥉', color: 'text-amber-600', bar: 'bg-amber-600', min: 0 },
    { key: 'silver', name: 'Silver', emoji: '🥈', color: 'text-gray-300', bar: 'bg-gray-300', min: 1050 },
    { key: 'gold', name: 'Gold', emoji: '🥇', color: 'text-yellow-400', bar: 'bg-yellow-400', min: 1140 },
    { key: 'platinum', name: 'Platinum', emoji: '🛡️', color: 'text-cyan-200', bar: 'bg-cyan-200', min: 1280 },
    { key: 'diamond', name: 'Diamond', emoji: '💎', color: 'text-sky-300', bar: 'bg-sky-300', min: 1430 },
    { key: 'master', name: 'Master', emoji: '👑', color: 'text-purple-400', bar: 'bg-purple-400', min: 1580 },
    { key: 'grandmaster', name: 'GrandMaster', emoji: '⚡', color: 'text-red-400', bar: 'bg-red-400', min: 1700 },
];

export const GRANDMASTER = RANK_TIERS[RANK_TIERS.length - 1];
export const MASTER = RANK_TIERS[RANK_TIERS.length - 2];

/**
 * Only so many people get the lightning bolt: GrandMaster seats scale with
 * the ranked population (1 seat per 8 ranked players, always at least 1).
 * Players over the GM floor but out of seats show as Master — the
 * leaderboard applies this, since it's the one place that sees everyone.
 */
export const gmSeatCount = (rankedPlayers: number): number =>
    Math.max(1, Math.ceil(rankedPlayers / 8));

export interface RankInfo {
    tier: RankTier;
    rating: number;
    /** next tier, or null at GrandMaster */
    next: RankTier | null;
    /** 0..1 progress from this tier's floor to the next */
    progress: number;
    /** whole-number win percent, or null before any game finishes */
    winPct: number | null;
}

export const rankFor = (
    rating: number,
    s?: { gamesPlayed: number; gamesWon: number },
): RankInfo => {
    let tier = RANK_TIERS[0];
    for (const t of RANK_TIERS) if (rating >= t.min) tier = t;
    const idx = RANK_TIERS.indexOf(tier);
    const next = RANK_TIERS[idx + 1] ?? null;
    const progress = next
        ? Math.max(0, Math.min(1, (rating - tier.min) / (next.min - tier.min)))
        : 1;
    const winPct = s && s.gamesPlayed > 0
        ? Math.round((s.gamesWon / s.gamesPlayed) * 100)
        : null;
    return { tier, rating, next, progress, winPct };
};
