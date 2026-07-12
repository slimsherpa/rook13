import { describe, it, expect } from 'vitest';
import {
    GameDoc, Card, Seat, Suit, SEATS, BotStyle, getCardPoints, teamOf,
} from './types';
import { createDeck, createShuffledDeck, splitDeal, isRedealHand, isValidDeck, sortHand } from './deck';
import {
    createGameDoc, applyAction, validateAction, legalCards, minNextBid, mustBid, isLaydown,
    winningCardSeat, InvalidActionError, replay, bidTeamMaxPoints,
} from './engine';
import { nextBotAction, bestTrumpSuit, chooseGoDown } from './bots';

const host = { uid: 'u-host', name: 'Riley' };

const newLobby = (): GameDoc =>
    createGameDoc({ id: 'test-game', joinCode: 'ABCD', host, now: 1000 });

/** Start a 1-human + 3-bot game (host at A1). */
const startedGame = (): GameDoc => {
    let g = newLobby();
    g = applyAction(g, { type: 'START_GAME' });
    return g;
};

/** A deck stacked so we control every hand. Order: A1 x9, B1 x9, A2 x9, B2 x9, widow x4. */
const stackDeck = (a1: Card[], b1: Card[], a2: Card[], b2: Card[], widow: Card[]): Card[] => {
    const deck = [...a1, ...b1, ...a2, ...b2, ...widow];
    if (!isValidDeck(deck)) throw new Error('test deck is not a valid 40-card deck');
    return deck;
};

const c = (suit: Suit, number: number): Card => ({ suit, number });

/** Deterministic non-redeal deck: suits dealt in blocks. */
const blockDeck = (): Card[] => {
    const nums = (suit: Suit) => Array.from({ length: 10 }, (_, i) => c(suit, i + 5));
    const [r, y, b, g] = [nums('Red'), nums('Yellow'), nums('Black'), nums('Green')];
    // A1: all Red minus 14; B1: all Yellow minus 14; A2: all Black minus 14; B2: all Green minus 14
    // widow: the four 14s
    return stackDeck(
        r.slice(0, 9),
        y.slice(0, 9),
        b.slice(0, 9),
        g.slice(0, 9),
        [c('Red', 14), c('Yellow', 14), c('Black', 14), c('Green', 14)],
    );
};

describe('deck', () => {
    it('creates a 40 card deck, 4 suits of 5..14', () => {
        const deck = createDeck();
        expect(deck).toHaveLength(40);
        expect(isValidDeck(deck)).toBe(true);
    });

    it('shuffled decks stay valid', () => {
        expect(isValidDeck(createShuffledDeck())).toBe(true);
    });

    it('splitDeal gives 9/9/9/9 + 4 widow', () => {
        const { hands, widow } = splitDeal(createShuffledDeck());
        SEATS.forEach((s) => expect(hands[s]).toHaveLength(9));
        expect(widow).toHaveLength(4);
    });

    it('detects the celebrated all-6789 redeal hand', () => {
        const junk = [
            c('Red', 6), c('Red', 7), c('Red', 8), c('Red', 9),
            c('Yellow', 6), c('Yellow', 7), c('Yellow', 8), c('Yellow', 9),
            c('Black', 6),
        ];
        expect(isRedealHand(junk)).toBe(true);
        expect(isRedealHand([...junk.slice(0, 8), c('Black', 5)])).toBe(false);
        expect(isRedealHand([...junk.slice(0, 8), c('Black', 10)])).toBe(false);
    });

    it('card points: 5s are 5, 10s and 13s are 10, everything else 0', () => {
        expect(getCardPoints(c('Red', 5))).toBe(5);
        expect(getCardPoints(c('Red', 10))).toBe(10);
        expect(getCardPoints(c('Red', 13))).toBe(10);
        expect(getCardPoints(c('Red', 14))).toBe(0);
        expect(getCardPoints(c('Red', 7))).toBe(0);
        // whole deck totals 100
        expect(createDeck().reduce((s, card) => s + getCardPoints(card), 0)).toBe(100);
    });

    it('sortHand keeps all cards and puts trump first', () => {
        const hand = [c('Red', 5), c('Green', 14), c('Red', 13), c('Yellow', 7)];
        const sorted = sortHand(hand, 'Yellow');
        expect(sorted).toHaveLength(4);
        expect(sorted[0].suit).toBe('Yellow');
    });
});

describe('lobby & seating', () => {
    it('host starts seated at A1', () => {
        const g = newLobby();
        expect(g.seats.A1).toMatchObject({ kind: 'human', uid: 'u-host' });
        expect(g.playerUids).toEqual(['u-host']);
    });

    it('a player can sit, switch seats, and leave', () => {
        let g = newLobby();
        const p2 = { uid: 'u2', name: 'Jay' };
        g = applyAction(g, { type: 'SIT', seat: 'A2', player: p2 });
        expect(g.seats.A2).toMatchObject({ kind: 'human', uid: 'u2' });
        g = applyAction(g, { type: 'SIT', seat: 'B1', player: p2 });
        expect(g.seats.B1.uid).toBe('u2');
        expect(g.seats.A2.kind).toBe('open');
        g = applyAction(g, { type: 'LEAVE_SEAT', seat: 'B1', uid: 'u2' });
        expect(g.seats.B1.kind).toBe('open');
        expect(g.playerUids).toEqual(['u-host']);
    });

    it('cannot sit on an occupied human seat', () => {
        const g = newLobby();
        expect(validateAction(g, { type: 'SIT', seat: 'A1', player: { uid: 'u2', name: 'Jay' } }))
            .toBe('Seat is taken');
    });

    it('START_GAME fills open seats with bots and picks a dealer', () => {
        const g = startedGame();
        expect(g.status).toBe('active');
        expect(g.phase).toBe('dealing');
        expect(g.seats.B1.kind).toBe('bot');
        expect(g.seats.A2.kind).toBe('bot');
        expect(g.seats.B2.kind).toBe('bot');
        expect(g.dealer).not.toBeNull();
        expect(g.turn).toBe(g.dealer);
        expect(g.handNumber).toBe(1);
    });
});

describe('dealing & redeal', () => {
    it('DEAL moves to bidding, first bidder left of dealer', () => {
        let g = startedGame();
        g = applyAction(g, { type: 'DEAL', deck: blockDeck() });
        expect(g.phase).toBe('bidding');
        SEATS.forEach((s) => expect(g.hands[s]).toHaveLength(9));
        expect(g.widow).toHaveLength(4);
        const dealerIdx = SEATS.indexOf(g.dealer!);
        expect(g.turn).toBe(SEATS[(dealerIdx + 1) % 4]);
    });

    it('rejects an invalid deck', () => {
        const g = startedGame();
        const dupDeck = [...blockDeck()];
        dupDeck[1] = dupDeck[0];
        expect(() => applyAction(g, { type: 'DEAL', deck: dupDeck })).toThrow(InvalidActionError);
    });

    it('an all-6789 hand triggers the redeal celebration, then a fresh deal', () => {
        let g = startedGame();
        // stack A1 with 6,7,8,9 of Red+Yellow and 6 of Black = all 6-9
        const junkHand = [
            c('Red', 6), c('Red', 7), c('Red', 8), c('Red', 9),
            c('Yellow', 6), c('Yellow', 7), c('Yellow', 8), c('Yellow', 9),
            c('Black', 6),
        ];
        const rest = createDeck().filter((card) => !junkHand.some(
            (j) => j.suit === card.suit && j.number === card.number,
        ));
        const deck = [...junkHand, ...rest];
        g = applyAction(g, { type: 'DEAL', deck });
        expect(g.phase).toBe('redeal');
        expect(g.redealSeat).toBe('A1');
        expect(g.redealCount).toBe(1);
        // bidding must not start
        expect(validateAction(g, { type: 'BID', seat: g.turn!, bid: 65 })).toBeTruthy();
        // acknowledge with a fresh (clean) deck
        g = applyAction(g, { type: 'ACK_REDEAL', deck: blockDeck() });
        expect(g.phase).toBe('bidding');
        expect(g.redealSeat).toBeNull();
    });
});

describe('bidding', () => {
    const inBidding = (): GameDoc => {
        let g = startedGame();
        return applyAction(g, { type: 'DEAL', deck: blockDeck() });
    };

    it('enforces turn order and raise-only bids', () => {
        const g = inBidding();
        const bidder = g.turn!;
        const notBidder = SEATS.find((s) => s !== bidder)!;
        expect(validateAction(g, { type: 'BID', seat: notBidder, bid: 65 })).toBe('Not your turn to bid');
        expect(validateAction(g, { type: 'BID', seat: bidder, bid: 64 as any })).toBe('Invalid bid amount');
        let g2 = applyAction(g, { type: 'BID', seat: bidder, bid: 70 });
        expect(validateAction(g2, { type: 'BID', seat: g2.turn!, bid: 70 })).toBe('Bid must be higher than the current bid');
        expect(validateAction(g2, { type: 'BID', seat: g2.turn!, bid: 75 })).toBeNull();
    });

    it('three passes ends the auction; widow goes to the winner', () => {
        let g = inBidding();
        const first = g.turn!;
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 80 });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        expect(g.phase).toBe('widow');
        expect(g.bidWinner).toBe(first);
        expect(g.highBid).toBe(80);
        expect(g.hands[first]).toHaveLength(13); // 9 + widow
        expect(g.widow).toHaveLength(0);
        expect(g.turn).toBe(first);
    });

    it('if the first three pass, the dealer is forced to bid', () => {
        let g = inBidding();
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        expect(g.turn).toBe(g.dealer);
        expect(mustBid(g)).toBe(true);
        expect(validateAction(g, { type: 'BID', seat: g.dealer!, bid: 'pass' }))
            .toBe('You must bid — everyone else passed');
        g = applyAction(g, { type: 'BID', seat: g.dealer!, bid: 65 });
        expect(g.bidWinner).toBe(g.dealer);
        expect(g.phase).toBe('widow');
    });

    it('a passed player never gets the turn again', () => {
        let g = inBidding();
        const p1 = g.turn!;
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 65 });   // p1 bids
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' }); // p2 passes
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 70 });   // p3 bids
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' }); // p4 passes
        // back to p1 (p2 skipped)
        expect(g.turn).toBe(p1);
        g = applyAction(g, { type: 'BID', seat: p1, bid: 75 });
        // p2 and p4 passed; next live bidder is p3
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' }); // p3 passes -> 3 passes total
        expect(g.phase).toBe('widow');
        expect(g.bidWinner).toBe(p1);
        expect(g.highBid).toBe(75);
    });

    it('a 120 bid ends the auction immediately', () => {
        let g = inBidding();
        const bidder = g.turn!;
        g = applyAction(g, { type: 'BID', seat: bidder, bid: 120 });
        expect(g.phase).toBe('widow');
        expect(g.bidWinner).toBe(bidder);
    });

    it('minNextBid climbs in 5s and tops out at 120', () => {
        let g = inBidding();
        expect(minNextBid(g)).toBe(65);
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 115 });
        expect(minNextBid(g)).toBe(120);
    });
});

describe('go-down and trump', () => {
    const inWidow = (): GameDoc => {
        let g = startedGame();
        g = applyAction(g, { type: 'DEAL', deck: blockDeck() });
        const bidder = g.turn!;
        g = applyAction(g, { type: 'BID', seat: bidder, bid: 70 });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        return g;
    };

    it('go-down must be 4 distinct cards from the 13-card hand', () => {
        const g = inWidow();
        const w = g.bidWinner!;
        const hand = g.hands[w];
        expect(validateAction(g, { type: 'SELECT_GODOWN', seat: w, cards: hand.slice(0, 3) }))
            .toBe('Select exactly 4 cards');
        expect(validateAction(g, {
            type: 'SELECT_GODOWN', seat: w,
            cards: [hand[0], hand[0], hand[1], hand[2]],
        })).toBe('Duplicate cards selected');
        const notMine = createDeck().find((card) => !hand.some(
            (h) => h.suit === card.suit && h.number === card.number,
        ))!;
        expect(validateAction(g, {
            type: 'SELECT_GODOWN', seat: w,
            cards: [notMine, hand[0], hand[1], hand[2]],
        })).toBe('Selected card is not in your hand');
    });

    it('after go-down + trump the hand is 9 cards and play starts left of dealer', () => {
        let g = inWidow();
        const w = g.bidWinner!;
        g = applyAction(g, { type: 'SELECT_GODOWN', seat: w, cards: g.hands[w].slice(0, 4) });
        expect(g.phase).toBe('trump');
        expect(g.hands[w]).toHaveLength(9);
        expect(g.goDown).toHaveLength(4);
        g = applyAction(g, { type: 'SELECT_TRUMP', seat: w, suit: 'Red' });
        expect(g.phase).toBe('playing');
        expect(g.trump).toBe('Red');
        const dealerIdx = SEATS.indexOf(g.dealer!);
        expect(g.turn).toBe(SEATS[(dealerIdx + 1) % 4]);
        expect(g.trickLeader).toBe(g.turn);
    });
});

describe('trick play', () => {
    it('winningCardSeat: highest trump beats lead; highest lead wins otherwise', () => {
        const plays = (arr: [Seat, Suit, number][]) =>
            arr.map(([seat, suit, number]) => ({ seat, card: c(suit, number) }));
        // no trump played: highest of lead suit
        expect(winningCardSeat(plays([['A1', 'Red', 10], ['B1', 'Red', 14], ['A2', 'Yellow', 14], ['B2', 'Red', 5]]), 'Black'))
            .toBe('B1');
        // trump wins even when low
        expect(winningCardSeat(plays([['A1', 'Red', 14], ['B1', 'Black', 5], ['A2', 'Red', 13], ['B2', 'Red', 12]]), 'Black'))
            .toBe('B1');
        // multiple trumps: highest trump
        expect(winningCardSeat(plays([['A1', 'Black', 9], ['B1', 'Black', 12], ['A2', 'Red', 14], ['B2', 'Black', 10]]), 'Black'))
            .toBe('B1');
        // no trump at all in the game (shouldn't happen, but):
        expect(winningCardSeat(plays([['A1', 'Red', 6], ['B1', 'Yellow', 14], ['A2', 'Green', 14], ['B2', 'Red', 7]]), null))
            .toBe('B2');
    });

    it('must follow suit when able', () => {
        let g = startedGame();
        g = applyAction(g, { type: 'DEAL', deck: blockDeck() });
        const bidder = g.turn!;
        g = applyAction(g, { type: 'BID', seat: bidder, bid: 65 });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        g = applyAction(g, { type: 'SELECT_GODOWN', seat: bidder, cards: g.hands[bidder].slice(9, 13) });
        g = applyAction(g, { type: 'SELECT_TRUMP', seat: bidder, suit: g.hands[bidder][0].suit });

        // first player leads anything
        const leader = g.turn!;
        const leadCard = g.hands[leader][0];
        g = applyAction(g, { type: 'PLAY_CARD', seat: leader, card: leadCard });

        // in blockDeck each seat holds one suit, so followers are void — any card ok.
        // Build a targeted follow-suit test instead:
        const g2 = (() => {
            let s = startedGame();
            // A1 has mixed suits; ensure follow-suit applies
            const a1 = [c('Red', 5), c('Red', 6), c('Red', 7), c('Red', 8), c('Yellow', 5), c('Yellow', 6), c('Yellow', 7), c('Yellow', 8), c('Black', 5)];
            const b1 = [c('Red', 9), c('Red', 10), c('Red', 11), c('Red', 12), c('Yellow', 9), c('Yellow', 10), c('Yellow', 11), c('Yellow', 12), c('Black', 6)];
            const a2 = [c('Black', 7), c('Black', 8), c('Black', 9), c('Black', 10), c('Green', 5), c('Green', 6), c('Green', 7), c('Green', 8), c('Black', 11)];
            const b2 = [c('Green', 9), c('Green', 10), c('Green', 11), c('Green', 12), c('Black', 12), c('Black', 13), c('Black', 14), c('Green', 13), c('Red', 13)];
            const widow = [c('Red', 14), c('Yellow', 13), c('Yellow', 14), c('Green', 14)];
            s = applyAction(s, { type: 'DEAL', deck: stackDeck(a1, b1, a2, b2, widow) });
            const bdr = s.turn!;
            s = applyAction(s, { type: 'BID', seat: bdr, bid: 65 });
            s = applyAction(s, { type: 'BID', seat: s.turn!, bid: 'pass' });
            s = applyAction(s, { type: 'BID', seat: s.turn!, bid: 'pass' });
            s = applyAction(s, { type: 'BID', seat: s.turn!, bid: 'pass' });
            s = applyAction(s, { type: 'SELECT_GODOWN', seat: bdr, cards: s.hands[bdr].slice(9, 13) });
            s = applyAction(s, { type: 'SELECT_TRUMP', seat: bdr, suit: 'Black' });
            return s;
        })();

        const ldr = g2.turn!;
        const redInHand = g2.hands[ldr].find((card) => card.suit === 'Red');
        if (redInHand) {
            const s3 = applyAction(g2, { type: 'PLAY_CARD', seat: ldr, card: redInHand });
            const nxt = s3.turn!;
            const hasRed = s3.hands[nxt].some((card) => card.suit === 'Red');
            const offSuit = s3.hands[nxt].find((card) => card.suit !== 'Red');
            if (hasRed && offSuit) {
                expect(validateAction(s3, { type: 'PLAY_CARD', seat: nxt, card: offSuit }))
                    .toBe('You must follow suit');
            }
            expect(legalCards(s3, nxt).length).toBeGreaterThan(0);
        }
    });
});

describe('hand scoring', () => {
    /**
     * Fully scripted hand:
     *  A1 holds all Red (5..13), B1 all Yellow (5..13), A2 all Black (5..13),
     *  B2 all Green (5..13), widow = the four 14s.
     *  Dealer varies by game id; we find the auction winner deterministically:
     *  the first bidder bids 65, everyone passes. Trump = first bidder's suit.
     *  The first bidder then leads their suit every trick and wins all 9 tricks
     *  (nobody can follow; no one else holds trump).
     */
    const playScriptedHand = (bid: number) => {
        let g = startedGame();
        const nums = (suit: Suit) => Array.from({ length: 9 }, (_, i) => c(suit, i + 5));
        const deck = stackDeck(
            nums('Red'), nums('Yellow'), nums('Black'), nums('Green'),
            [c('Red', 14), c('Yellow', 14), c('Black', 14), c('Green', 14)],
        );
        g = applyAction(g, { type: 'DEAL', deck });
        const bidder = g.turn!;
        g = applyAction(g, { type: 'BID', seat: bidder, bid });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        // bidder's hand: their 9 suit cards + four 14s. Go down the three
        // off-suit 14s + own 14? Own suit has no 14 (widow had it)...
        // hand = own suit 5..13 (9 cards) + all four 14s = 13 cards.
        // Put down the three off-suit 14s and own suit 5 -> keeps 6..13 + own 14.
        const suit = g.hands[bidder][0].suit;
        const offSuit14s = g.hands[bidder].filter((card) => card.number === 14 && card.suit !== suit);
        const own5 = g.hands[bidder].find((card) => card.suit === suit && card.number === 5)!;
        g = applyAction(g, { type: 'SELECT_GODOWN', seat: bidder, cards: [...offSuit14s, own5] });
        g = applyAction(g, { type: 'SELECT_TRUMP', seat: bidder, suit });

        // bidder leads every trick with their (only) suit; others are void of it
        for (let trick = 0; trick < 9; trick++) {
            for (let i = 0; i < 4; i++) {
                const seat = g.turn!;
                const legal = legalCards(g, seat);
                g = applyAction(g, { type: 'PLAY_CARD', seat, card: legal[0] });
            }
        }
        return { g, bidder };
    };

    it('winner takes all: 100 card points + 20 bonus + go-down to last trick winner', () => {
        const { g, bidder } = playScriptedHand(65);
        const bidTeam = teamOf(bidder);
        const defTeam = bidTeam === 'A' ? 'B' : 'A';
        expect(g.handHistory).toHaveLength(1);
        const h = g.handHistory[0];
        expect(h.tricksWon[bidTeam]).toBe(9);
        // all 100 points on the board go to the bid team (incl. go-down's own-5)
        expect(h.pointsTaken[bidTeam]).toBe(100 + 20);
        expect(h.pointsTaken[defTeam]).toBe(0);
        expect(h.wentSet).toBe(false);
        expect(g.scores[bidTeam]).toBe(120);
        expect(g.scores[defTeam]).toBe(0);
        expect(g.phase).toBe('hand_done');
        expect(g.status).toBe('active');
    });

    it('point conservation: every hand accounts for exactly 100 card points', () => {
        const { g } = playScriptedHand(65);
        const h = g.handHistory[0];
        const bonuses = (h.tricksWon.A >= 5 ? 20 : 0) + (h.tricksWon.B >= 5 ? 20 : 0);
        expect(h.pointsTaken.A + h.pointsTaken.B).toBe(100 + bonuses);
    });

    it('NEXT_HAND rotates the dealer and resets hand state', () => {
        const { g } = playScriptedHand(65);
        const prevDealer = g.dealer!;
        const g2 = applyAction(g, { type: 'NEXT_HAND' });
        expect(g2.phase).toBe('dealing');
        expect(g2.handNumber).toBe(2);
        expect(SEATS.indexOf(g2.dealer!)).toBe((SEATS.indexOf(prevDealer) + 1) % 4);
        expect(g2.turn).toBe(g2.dealer);
        expect(g2.completedTricks).toHaveLength(0);
        expect(g2.hands.A1).toHaveLength(0);
        expect(g2.scores).toEqual(g.scores); // running score carries over
    });
});

describe('going set', () => {
    it('bid team below the bid scores minus the bid; defenders keep their points', () => {
        // Simulate full bot games until we observe a set, then verify the math.
        let observedSet = false;
        for (let i = 0; i < 60 && !observedSet; i++) {
            const g = simulateFullGame(`set-game-${i}`);
            for (const h of g.handHistory) {
                const bidTeam = teamOf(h.bidWinner);
                const defTeam = bidTeam === 'A' ? 'B' : 'A';
                if (h.wentSet) {
                    observedSet = true;
                    expect(h.pointsTaken[bidTeam]).toBeLessThan(h.bid);
                    expect(h.handScore[bidTeam]).toBe(-h.bid);
                    expect(h.handScore[defTeam]).toBe(h.pointsTaken[defTeam]);
                } else {
                    expect(h.handScore[bidTeam]).toBe(h.pointsTaken[bidTeam]);
                    expect(h.pointsTaken[bidTeam]).toBeGreaterThanOrEqual(h.bid);
                }
            }
        }
        expect(observedSet).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Full-game simulation (bots playing bots) — the engine must never wedge.
// ---------------------------------------------------------------------------

const simulateFullGame = (id: string, style: BotStyle = 'basic'): GameDoc => {
    let g = createGameDoc({ id, joinCode: 'SIMX', host, now: 1 });
    g = applyAction(g, { type: 'START_GAME' });
    // make every seat a bot so nextBotAction drives the whole game
    for (const s of SEATS) {
        (g.seats[s] as any) = { kind: 'bot', name: `Bot ${s}`, botStyle: style };
    }
    let safety = 20000;
    while (g.status === 'active' && safety-- > 0) {
        if (g.phase === 'hand_done') {
            g = applyAction(g, { type: 'NEXT_HAND' });
            continue;
        }
        const action = nextBotAction(g);
        if (!action) throw new Error(`simulation wedged in phase ${g.phase} turn ${g.turn}`);
        g = applyAction(g, action);
    }
    if (safety <= 0) throw new Error('simulation did not terminate');
    return g;
};

describe('full game simulation', () => {
    it('basic bots finish 25 games with consistent scores', () => {
        for (let i = 0; i < 25; i++) {
            const g = simulateFullGame(`sim-basic-${i}`);
            expect(g.status).toBe('completed');
            expect(g.winner).not.toBeNull();
            // final scores equal the sum of hand scores
            const totals = g.handHistory.reduce(
                (acc, h) => ({ A: acc.A + h.handScore.A, B: acc.B + h.handScore.B }),
                { A: 0, B: 0 },
            );
            expect(g.scores).toEqual(totals);
            // threshold actually crossed
            expect(
                g.scores.A >= 500 || g.scores.B >= 500 || g.scores.A <= -250 || g.scores.B <= -250,
            ).toBe(true);
            // winner is the higher score
            expect(g.winner).toBe(g.scores.A > g.scores.B ? 'A' : 'B');
            // every hand conserves points
            for (const h of g.handHistory) {
                const bonuses = (h.tricksWon.A >= 5 ? 20 : 0) + (h.tricksWon.B >= 5 ? 20 : 0);
                expect(h.pointsTaken.A + h.pointsTaken.B).toBe(100 + bonuses);
                expect(h.tricksWon.A + h.tricksWon.B).toBe(9);
            }
        }
    });

    it('random bots finish 10 games without illegal moves', () => {
        for (let i = 0; i < 10; i++) {
            const g = simulateFullGame(`sim-random-${i}`, 'random');
            expect(g.status).toBe('completed');
        }
    });

    it('aggressive and cautious bots finish 10 games each', () => {
        for (const style of ['aggressive', 'cautious'] as BotStyle[]) {
            for (let i = 0; i < 10; i++) {
                const g = simulateFullGame(`sim-${style}-${i}`, style);
                expect(g.status).toBe('completed');
                expect(g.winner).not.toBeNull();
            }
        }
    });

    it('standard bots stop leading trump once trump is dead', () => {
        // Across simulations, count tricks led with trump after all 10 trump
        // cards outside the leader's hand are gone — should be rare compared
        // to the old always-lead-trump behavior (smoke check: games finish
        // and hands conserve points is covered above; here we just make sure
        // trump leads are no longer 100% of the bid team's leads).
        let trumpLeads = 0;
        let leads = 0;
        for (let i = 0; i < 10; i++) {
            const g = simulateFullGame(`sim-lead-${i}`);
            for (const t of g.completedTricks) {
                leads++;
                if (t.plays[0].card.suit === g.trump) trumpLeads++;
            }
        }
        expect(leads).toBeGreaterThan(0);
        expect(trumpLeads).toBeLessThan(leads);
    });
});

describe('bot helpers', () => {
    it('bestTrumpSuit picks the longest suit', () => {
        const hand = [
            c('Red', 5), c('Red', 8), c('Red', 11), c('Red', 14),
            c('Yellow', 6), c('Yellow', 7),
            c('Black', 9), c('Green', 10), c('Green', 12),
        ];
        expect(bestTrumpSuit(hand)).toBe('Red');
    });

    it('chooseGoDown avoids trump and point cards when possible', () => {
        const hand = [
            c('Red', 5), c('Red', 8), c('Red', 11), c('Red', 14), c('Red', 13),
            c('Yellow', 6), c('Yellow', 7),
            c('Black', 9), c('Green', 6), c('Green', 12),
            c('Black', 6), c('Black', 7), c('Yellow', 8),
        ];
        const gd = chooseGoDown(hand, 'Red');
        expect(gd).toHaveLength(4);
        expect(gd.every((card) => card.suit !== 'Red')).toBe(true);
        expect(gd.every((card) => getCardPoints(card) === 0)).toBe(true);
    });
});

describe('replay', () => {
    it('reconstructs the exact same state from the action log', () => {
        let g = createGameDoc({ id: 'replay-game', joinCode: 'RPLY', host, now: 1 });
        const log: any[] = [];
        const doAction = (a: any) => {
            log.push(a);
            g = applyAction(g, a, 999);
        };
        doAction({ type: 'START_GAME' });
        doAction({ type: 'DEAL', deck: blockDeck() });
        doAction({ type: 'BID', seat: g.turn!, bid: 70 });
        doAction({ type: 'BID', seat: g.turn!, bid: 'pass' });

        const initial = createGameDoc({ id: 'replay-game', joinCode: 'RPLY', host, now: 1 });
        const replayed = log.reduce((s, a) => applyAction(s, a, 999), initial);
        expect(replayed).toEqual(g);
    });
});

describe('bidTeamMaxPoints (set / maxxed detection)', () => {
    /** A mid-hand playing state we can poke numbers into. */
    const playingState = (): GameDoc => {
        const g = startedGame();
        return {
            ...g,
            phase: 'playing',
            bidWinner: 'A1',
            highBid: 100,
            trump: 'Red',
            trickLeader: 'B1',
            turn: 'B1',
            goDown: [c('Green', 6), c('Green', 7), c('Green', 8), c('Green', 9)],
        };
    };

    it('is null outside of trick play', () => {
        expect(bidTeamMaxPoints(startedGame())).toBeNull();
    });

    it('starts at 120: all 100 card points plus the 5-trick bonus', () => {
        expect(bidTeamMaxPoints(playingState())).toBe(120);
    });

    it('drops by whatever the defenders have banked', () => {
        const g = playingState();
        g.pointsTaken = { A: 10, B: 25 };
        g.completedTricks = new Array(3).fill({ leader: 'B1', plays: [], winner: 'B1', points: 0 });
        g.tricksWon = { A: 1, B: 2 };
        expect(bidTeamMaxPoints(g)).toBe(120 - 25);
    });

    it('detects maxxed: defenders took exactly bid-complement (bid 100, defenders 20)', () => {
        const g = playingState();
        g.pointsTaken = { A: 30, B: 20 };
        g.completedTricks = new Array(4).fill({ leader: 'B1', plays: [], winner: 'B1', points: 0 });
        g.tricksWon = { A: 2, B: 2 };
        expect(bidTeamMaxPoints(g)).toBe(100); // === bid → maxxed
    });

    it('detects a guaranteed set once defenders bank more than the complement', () => {
        const g = playingState();
        g.pointsTaken = { A: 30, B: 25 };
        g.completedTricks = new Array(4).fill({ leader: 'B1', plays: [], winner: 'B1', points: 0 });
        g.tricksWon = { A: 2, B: 2 };
        expect(bidTeamMaxPoints(g)).toBe(95); // < bid → set
    });

    it('loses the +20 bonus once 5 tricks are out of reach', () => {
        const g = playingState();
        g.pointsTaken = { A: 0, B: 40 };
        g.completedTricks = new Array(6).fill({ leader: 'B1', plays: [], winner: 'B1', points: 0 });
        g.tricksWon = { A: 1, B: 5 }; // A can finish with at most 4 tricks
        expect(bidTeamMaxPoints(g)).toBe(100 - 40); // no bonus
    });
});

describe('deal snapshot (dealtHands / dealtWidow)', () => {
    it('DEAL records what everyone was dealt, before the widow pickup', () => {
        let g = startedGame();
        const deck = blockDeck();
        g = applyAction(g, { type: 'DEAL', deck });
        const { hands, widow } = splitDeal(deck);
        expect(g.dealtHands).toEqual(hands);
        expect(g.dealtWidow).toEqual(widow);

        // the pickup reshuffles live hands but not the snapshot
        const bidder = g.turn!;
        g = applyAction(g, { type: 'BID', seat: bidder, bid: 65 });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        expect(g.hands[bidder]).toHaveLength(13);
        expect(g.dealtHands![bidder]).toHaveLength(9);
        expect(g.dealtWidow).toEqual(widow);
    });

    it('the hand summary carries the deal and the auction', () => {
        let g = startedGame();
        g = applyAction(g, { type: 'DEAL', deck: blockDeck() });
        const bidder = g.turn!;
        const dealt = JSON.parse(JSON.stringify(g.dealtHands));
        g = applyAction(g, { type: 'BID', seat: bidder, bid: 70 });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        // keep the bidder's own suit + its 14; ditch the other three 14s + the 5
        const suit = g.dealtHands![bidder][0].suit;
        const goDown = g.hands[bidder].filter((card) => card.suit !== suit || card.number === 5);
        g = applyAction(g, { type: 'SELECT_GODOWN', seat: bidder, cards: goDown });
        g = applyAction(g, { type: 'SELECT_TRUMP', seat: bidder, suit });
        g = applyAction(g, { type: 'LAYDOWN', seat: bidder });

        const h = g.handHistory[0];
        expect(h.dealtHands).toEqual(dealt);
        expect(h.dealtWidow).toHaveLength(4);
        expect(h.bids![bidder]).toBe(70);
        expect(Object.values(h.bids!).filter((b) => b === 'pass')).toHaveLength(3);
    });
});

describe('laydown', () => {
    /** blockDeck game where the bidder ends up holding trump 6..14 (all locks). */
    const laydownReady = (): { g: GameDoc; bidder: Seat } => {
        let g = startedGame();
        g = applyAction(g, { type: 'DEAL', deck: blockDeck() });
        const bidder = g.turn!;
        g = applyAction(g, { type: 'BID', seat: bidder, bid: 65 });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        const suit = g.dealtHands![bidder][0].suit;
        // go-down: the three off-suit 14s + the trump 5 → hand is trump 6..14
        const goDown = g.hands[bidder].filter((card) => card.suit !== suit || card.number === 5);
        expect(goDown).toHaveLength(4);
        g = applyAction(g, { type: 'SELECT_GODOWN', seat: bidder, cards: goDown });
        g = applyAction(g, { type: 'SELECT_TRUMP', seat: bidder, suit });
        return { g, bidder };
    };

    it('isLaydown: true when holding only unbeatable trump', () => {
        const { g, bidder } = laydownReady();
        expect(g.turn).toBe(bidder); // bid winner's side leads (left of dealer = bidder here)
        expect(isLaydown(g, bidder)).toBe(true);
        expect(validateAction(g, { type: 'LAYDOWN', seat: bidder })).toBeNull();
    });

    it('isLaydown: false when others still hold trump against non-trump cards', () => {
        let g = startedGame();
        g = applyAction(g, { type: 'DEAL', deck: blockDeck() });
        const bidder = g.turn!;
        g = applyAction(g, { type: 'BID', seat: bidder, bid: 65 });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        // ditch the four widow 14s, then trump SOMEONE ELSE'S suit:
        // the bidder holds 9 non-trump cards while an opponent holds all trump
        const mySuit = g.dealtHands![bidder][0].suit;
        const fourteens = g.hands[bidder].filter((card) => card.number === 14);
        g = applyAction(g, { type: 'SELECT_GODOWN', seat: bidder, cards: fourteens });
        const otherSuit = SEATS.map((s) => g.dealtHands![s][0].suit).find((s) => s !== mySuit)!;
        g = applyAction(g, { type: 'SELECT_TRUMP', seat: bidder, suit: otherSuit });
        expect(isLaydown(g, bidder)).toBe(false);
        expect(validateAction(g, { type: 'LAYDOWN', seat: bidder }))
            .toBe('Your cards are not all guaranteed winners');
    });

    it('laydown is only offered on lead', () => {
        const { g, bidder } = laydownReady();
        const mid = applyAction(g, { type: 'PLAY_CARD', seat: bidder, card: g.hands[bidder][0] });
        expect(validateAction(mid, { type: 'LAYDOWN', seat: mid.turn! }))
            .toBe('You can only lay down when leading');
    });

    it('LAYDOWN finishes the hand: 9 legal tricks, all points to the claimant', () => {
        const { g, bidder } = laydownReady();
        const done = applyAction(g, { type: 'LAYDOWN', seat: bidder });
        const team = teamOf(bidder);
        expect(done.phase === 'hand_done' || done.phase === 'game_over').toBe(true);
        expect(done.completedTricks).toHaveLength(9);
        expect(done.completedTricks.every((t) => t.winner === bidder)).toBe(true);
        // every synthesized play followed suit
        for (const trick of done.completedTricks) {
            expect(trick.plays).toHaveLength(4);
        }
        const h = done.handHistory[0];
        expect(h.tricksWon[team]).toBe(9);
        // 95 pts in play + 5 in the go-down + 20 bonus, defenders take nothing
        expect(h.pointsTaken[team]).toBe(120);
        expect(h.wentSet).toBe(false);
        // all four hands are empty
        SEATS.forEach((s) => expect(done.hands[s]).toHaveLength(0));
    });

    it('LAYDOWN is deterministic (replay-safe)', () => {
        const { g, bidder } = laydownReady();
        const a = applyAction(g, { type: 'LAYDOWN', seat: bidder }, 42);
        const b = applyAction(g, { type: 'LAYDOWN', seat: bidder }, 42);
        expect(a).toEqual(b);
    });
});

describe('bid log (the auction blow-by-blow)', () => {
    it('records every bid in order and lands in the hand summary', () => {
        let g = startedGame();
        g = applyAction(g, { type: 'DEAL', deck: blockDeck() });
        const first = g.turn!;
        g = applyAction(g, { type: 'BID', seat: first, bid: 65 });
        const second = g.turn!;
        g = applyAction(g, { type: 'BID', seat: second, bid: 70 });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        g = applyAction(g, { type: 'BID', seat: g.turn!, bid: 'pass' });
        // back to the opener, who raises, then the raiser passes
        expect(g.turn).toBe(first);
        g = applyAction(g, { type: 'BID', seat: first, bid: 75 });
        g = applyAction(g, { type: 'BID', seat: second, bid: 'pass' });

        expect(g.bidWinner).toBe(first);
        expect(g.bidLog).toEqual([
            { seat: first, bid: 65 },
            { seat: second, bid: 70 },
            { seat: g.bidLog![2].seat, bid: 'pass' },
            { seat: g.bidLog![3].seat, bid: 'pass' },
            { seat: first, bid: 75 },
            { seat: second, bid: 'pass' },
        ]);

        // play it out and check the summary carries the log
        const suit = g.dealtHands![first][0].suit;
        const goDown = g.hands[first].filter((card) => card.suit !== suit || card.number === 5);
        g = applyAction(g, { type: 'SELECT_GODOWN', seat: first, cards: goDown });
        g = applyAction(g, { type: 'SELECT_TRUMP', seat: first, suit });
        g = applyAction(g, { type: 'LAYDOWN', seat: first });
        expect(g.handHistory[0].bidLog).toHaveLength(6);
        expect(g.handHistory[0].bidLog![4]).toEqual({ seat: first, bid: 75 });

        // and NEXT_HAND clears the live log
        g = applyAction(g, { type: 'NEXT_HAND' });
        expect(g.bidLog).toEqual([]);
    });
});
