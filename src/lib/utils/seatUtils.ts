import { Seat } from '../types/game';

export const getNextSeat = (currentSeat: Seat): Seat => {
    const seats: Seat[] = ['A1', 'B1', 'A2', 'B2'];
    const currentIndex = seats.indexOf(currentSeat);
    return seats[(currentIndex + 1) % 4];
}; 