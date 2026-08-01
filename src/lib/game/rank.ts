// The lobby ladder — StarCraft-style tiers for the family. Rating rewards
// showing up AND winning: a win is worth three games of showing up, so
// grinders climb, but the top tiers demand real wins. Derived purely from
// UserStats (never stored), so it can't drift from the Trophy Case.

import { UserStats } from './stats';

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
    { key: 'silver', name: 'Silver', emoji: '🥈', color: 'text-gray-300', bar: 'bg-gray-300', min: 25 },
    { key: 'gold', name: 'Gold', emoji: '🥇', color: 'text-yellow-400', bar: 'bg-yellow-400', min: 60 },
    { key: 'platinum', name: 'Platinum', emoji: '🛡️', color: 'text-cyan-200', bar: 'bg-cyan-200', min: 120 },
    { key: 'diamond', name: 'Diamond', emoji: '💎', color: 'text-sky-300', bar: 'bg-sky-300', min: 250 },
    { key: 'master', name: 'Master', emoji: '👑', color: 'text-purple-400', bar: 'bg-purple-400', min: 450 },
    { key: 'grandmaster', name: 'GrandMaster', emoji: '⚡', color: 'text-red-400', bar: 'bg-red-400', min: 700 },
];

export const ratingOf = (s: Pick<UserStats, 'gamesPlayed' | 'gamesWon'>): number =>
    s.gamesWon * 3 + s.gamesPlayed;

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

export const rankFor = (s: Pick<UserStats, 'gamesPlayed' | 'gamesWon'>): RankInfo => {
    const rating = ratingOf(s);
    let tier = RANK_TIERS[0];
    for (const t of RANK_TIERS) if (rating >= t.min) tier = t;
    const idx = RANK_TIERS.indexOf(tier);
    const next = RANK_TIERS[idx + 1] ?? null;
    const progress = next ? Math.min(1, (rating - tier.min) / (next.min - tier.min)) : 1;
    const winPct = s.gamesPlayed > 0 ? Math.round((s.gamesWon / s.gamesPlayed) * 100) : null;
    return { tier, rating, next, progress, winPct };
};
