// Beat the Bot "why" lines — plain-language explanations built ONLY
// from facts we can actually compute: the structure of the bot's Go
// Down (voids created, trump kept, count buried) and the shape of its
// opening lead (trump pull, safe exit, boss cash). No invented
// probabilities — the dials and deltas carry the numeric evidence; this
// carries the card sense. Deeper per-world "why" (what happened inside
// the imagined worlds) needs the next corpus generation to bank each
// world's solved line.

import { SUITS, getCardPoints } from '../game/types';
import { GoDownItem, LeadItem, toCard } from './types';

const suitOf = (c: number) => Math.floor(c / 10);
const numOf = (c: number) => (c % 10) + 5;
const pts = (c: number) => getCardPoints(toCard(c));
export const cardName = (c: number) => `${SUITS[suitOf(c)]} ${numOf(c)}`;

/** Describe the bot's Go Down plan: trump kept, voids opened, count
 *  buried. All facts, computed from the hand itself. */
export const explainGoDown = (item: GoDownItem): string => {
    const hand13 = [...item.dealt, ...item.widow];
    const gd = item.bot.godown;
    const kept = hand13.filter((c) => !gd.includes(c));
    const trump = item.bot.trump;

    const bySuit = (cards: number[]) =>
        SUITS.map((_, s) => cards.filter((c) => suitOf(c) === s).length);
    const handSuits = bySuit(hand13);
    const keptSuits = bySuit(kept);
    const voided = SUITS.map((_, s) => s).filter(
        (s) => s !== trump && handSuits[s] > 0 && keptSuits[s] === 0);
    const buriedPts = gd.reduce((a, c) => a + pts(c), 0);
    const trumpKept = keptSuits[trump];

    const parts: string[] = [];
    parts.push(`My plan keeps ${trumpKept} ${SUITS[trump]} trump`);
    if (voided.length > 0) {
        parts.push(`empties ${voided.map((s) => SUITS[s]).join(' and ')} completely — a void I can trump into`);
    } else {
        const shortest = SUITS.map((_, s) => s)
            .filter((s) => s !== trump && keptSuits[s] > 0)
            .sort((a, b) => keptSuits[a] - keptSuits[b])[0];
        if (shortest !== undefined) {
            parts.push(`keeps ${SUITS[shortest]} short at ${keptSuits[shortest]}`);
        }
    }
    parts.push(buriedPts > 0
        ? `and banks ${buriedPts} count points in the Go Down`
        : `and buries no count at all — every point stays in play`);
    return parts.join(', ') + '.';
};

/** Describe the shape of the bot's opening lead. Conservative: only
 *  claims that follow from the leader's own hand and the table roles. */
export const explainLead = (item: LeadItem): string | null => {
    const c = item.bot.card;
    const suit = suitOf(c);
    const isTrump = suit === item.trump;
    const inSuit = item.cards.filter((x) => suitOf(x) === suit);
    const suitLen = inSuit.length;
    const highestOfMine = Math.max(...inSuit.map(numOf));
    const n = numOf(c);
    const count = pts(c);

    if (isTrump) {
        if (item.buyerRel === 0) {
            return 'A trump lead from the buyer’s chair — start pulling their trump while I hold control of the hand.';
        }
        if (item.buyerRel === 2) {
            return 'A trump lead into partner’s contract — it hands partner the wheel and pulls the defenders’ trump for them.';
        }
        return 'Leading trump straight at the buyer — every round of trump drains the contract’s engine.';
    }
    if (n === 14) {
        return `The ${SUITS[suit]} 14 is my sure boss — cash it before anyone goes void in ${SUITS[suit]}.`;
    }
    if (count === 0 && n <= 9 && suitLen >= 3) {
        return `A low ${SUITS[suit]} from my ${suitLen}-card suit — a safe exit: no count risked, nothing telegraphed, and the hand comes back around to me.`;
    }
    if (count === 0 && n < highestOfMine) {
        return `A ${SUITS[suit]} the opponents have to spend something real to beat — and it risks no count.`;
    }
    if (count > 0) {
        return `A count card up front — I’m betting this trick comes home to my side.`;
    }
    return null;
};

/** One conservative line about the PLAYER's lead, only when the shape
 *  difference is unmistakable. Null = let the delta speak. */
export const critiqueLead = (item: LeadItem, pick: number): string | null => {
    if (pick === item.bot.card) return null;
    const pickPts = pts(pick);
    const botPts = pts(item.bot.card);
    const pickTrump = suitOf(pick) === item.trump;
    const botTrump = suitOf(item.bot.card) === item.trump;
    if (pickPts > 0 && botPts === 0) {
        return `Your ${cardName(pick)} puts ${pickPts} count points on a trick nobody controls yet.`;
    }
    if (pickTrump && !botTrump && item.buyerRel !== 0 && item.buyerRel !== 2) {
        return 'Your trump lead spends the defense’s control early — I’d rather make the buyer break the suit.';
    }
    return null;
};
