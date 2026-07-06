import { Card, Seat, SEATS, SUITS, CARDS_PER_PLAYER, WIDOW_SIZE } from './types';

export const createDeck = (): Card[] => {
    const deck: Card[] = [];
    for (const suit of SUITS) {
        for (let number = 5; number <= 14; number++) {
            deck.push({ suit, number });
        }
    }
    return deck;
};

export const shuffle = <T>(array: T[], rng: () => number = Math.random): T[] => {
    const out = [...array];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
};

export const createShuffledDeck = (): Card[] => shuffle(createDeck());

/** Split a 40-card deck into four 9-card hands plus the 4-card widow. */
export const splitDeal = (deck: Card[]): { hands: Record<Seat, Card[]>; widow: Card[] } => {
    const hands = {} as Record<Seat, Card[]>;
    SEATS.forEach((seat, i) => {
        hands[seat] = deck.slice(i * CARDS_PER_PLAYER, (i + 1) * CARDS_PER_PLAYER);
    });
    const widow = deck.slice(SEATS.length * CARDS_PER_PLAYER, SEATS.length * CARDS_PER_PLAYER + WIDOW_SIZE);
    return { hands, widow };
};

/** True when a hand contains only 6s, 7s, 8s and 9s — the celebrated redeal. */
export const isRedealHand = (hand: Card[]): boolean =>
    hand.length > 0 && hand.every((c) => c.number >= 6 && c.number <= 9);

/** Validate that a deck is exactly the 40 Rook13 cards with no duplicates. */
export const isValidDeck = (deck: Card[]): boolean => {
    if (!Array.isArray(deck) || deck.length !== 40) return false;
    const seen = new Set<string>();
    for (const c of deck) {
        if (!c || !SUITS.includes(c.suit) || typeof c.number !== 'number') return false;
        if (c.number < 5 || c.number > 14 || !Number.isInteger(c.number)) return false;
        const key = `${c.suit}-${c.number}`;
        if (seen.has(key)) return false;
        seen.add(key);
    }
    return true;
};

/** Sort helper for display: group by suit (trump first when given), high to low. */
export const sortHand = (hand: Card[], trump: Card['suit'] | null = null): Card[] => {
    const bySuit = new Map<string, Card[]>();
    for (const c of hand) {
        if (!bySuit.has(c.suit)) bySuit.set(c.suit, []);
        bySuit.get(c.suit)!.push(c);
    }
    for (const cards of Array.from(bySuit.values())) {
        cards.sort((a, b) => b.number - a.number);
    }
    const suitsSorted = Array.from(bySuit.entries()).sort((a, b) => {
        if (trump) {
            if (a[0] === trump) return -1;
            if (b[0] === trump) return 1;
        }
        // longest suit first, then by total power
        if (a[1].length !== b[1].length) return b[1].length - a[1].length;
        const power = (cs: Card[]) => cs.reduce((s, c) => s + c.number, 0);
        return power(b[1]) - power(a[1]);
    });
    return suitsSorted.flatMap(([, cards]) => cards);
};
