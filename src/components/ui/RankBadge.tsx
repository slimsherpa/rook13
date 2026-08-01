// The ladder tier badge — one component so the lobby, the players page and
// the trophy case all render a rank the same way. Callers append their own
// suffix (win %, rating progress, …) after it.

import { RankInfo } from '@/lib/game/rank';

export default function RankBadge({ rank, className = '' }: { rank: RankInfo; className?: string }) {
    return (
        <span className={`font-orbitron font-bold ${rank.tier.color} ${className}`}>
            {rank.tier.emoji} {rank.tier.name}
        </span>
    );
}
