// Seat rotation: the signed-in player always sits at the bottom of the screen.
// Play proceeds clockwise A1 -> B1 -> A2 -> B2, which on screen runs
// bottom -> left -> top -> right.

import { Seat, nextSeat, partnerOf } from '@/lib/game/types';

export type TablePosition = 'bottom' | 'left' | 'top' | 'right';

export const positionsFor = (bottomSeat: Seat): Record<TablePosition, Seat> => ({
    bottom: bottomSeat,
    left: nextSeat(bottomSeat),
    top: partnerOf(bottomSeat),
    right: nextSeat(partnerOf(bottomSeat)),
});

export const positionOfSeat = (seat: Seat, bottomSeat: Seat): TablePosition => {
    const map = positionsFor(bottomSeat);
    return (Object.keys(map) as TablePosition[]).find((p) => map[p] === seat)!;
};
