// Beat the Bot difficulty layers — Bronze up to GrandMaster, unlocked one
// at a time (Riley's spec, 2026-08-17).
//
// The mill never stored a difficulty, but it stored something better: the
// searched value of every option (bot.values for leads, bot.cands[i][2]
// for go-downs). An item's difficulty is the VALUE GAP between the best
// and second-best distinct choices — a huge gap means one card is
// screaming to be played (obvious, Bronze); a tiny gap means even the
// searcher barely separated them (you really have to think, and guess a
// little better — GrandMaster). Twin cards (touching runs) are collapsed
// first so a "choice" between two copies of the same card never counts
// as a hard decision.
//
// Layers reuse the ladder's RANK_TIERS so the whole app speaks one tier
// language. The bank is bucketed by gap percentile with fatter easy
// buckets (lots for Bronze, a thin elite slice for GM), deterministic for
// a given bank. Promotion: LAYER_NEED perfect-or-close in your last
// LAYER_WINDOW answers of the current layer. No demotion — family game.

import { RANK_TIERS, RankTier } from '../game/rank';
import { runClass } from './scoring';
import { GoDownItem, LeadItem } from './types';

export const LAYER_TIERS: RankTier[] = RANK_TIERS;
export const TOP_LAYER = LAYER_TIERS.length - 1;

/** Promotion: this many perfect/close … */
export const LAYER_NEED = 10;
/** …inside your last this-many answers of the current layer. */
export const LAYER_WINDOW = 14;

/** Share of the bank per layer, easiest (Bronze) first. */
const LAYER_SHARE = [0.22, 0.18, 0.15, 0.13, 0.12, 0.11, 0.09];

/** Value gap best → second-best distinct lead (twins collapsed).
 *  Single-choice items return Infinity: no decision, trivially easy. */
export const leadGap = (item: LeadItem): number => {
    const byClass = new Map<number, number>();
    for (const [k, v] of Object.entries(item.bot.values)) {
        const cls = runClass(item.cards, Number(k));
        byClass.set(cls, Math.max(byClass.get(cls) ?? -Infinity, v));
    }
    const tops = Array.from(byClass.values()).sort((a, b) => b - a);
    return tops.length < 2 ? Infinity : tops[0] - tops[1];
};

/** Value gap best → second-best distinct (go-down, trump) candidate. */
export const godownGap = (item: GoDownItem): number => {
    const hand13 = [...item.dealt, ...item.widow];
    const byClass = new Map<string, number>();
    for (const [gd, trump, value] of item.bot.cands) {
        const key = `${trump}|${gd.map((c) => runClass(hand13, c)).sort((a, b) => a - b).join(',')}`;
        byClass.set(key, Math.max(byClass.get(key) ?? -Infinity, value));
    }
    const tops = Array.from(byClass.values()).sort((a, b) => b - a);
    return tops.length < 2 ? Infinity : tops[0] - tops[1];
};

/**
 * Bucket a bank into layers by gap percentile: item id → layer index.
 * Deterministic for a given bank; when the mill appends, items may shift
 * a layer as percentiles move, but done-sets are id-keyed so nobody's
 * progress ever breaks.
 */
export const layersFor = <T extends { id: number }>(
    items: T[], gapOf: (item: T) => number,
): Map<number, number> => {
    const sorted = items
        .map((it) => ({ id: it.id, gap: gapOf(it) }))
        .sort((a, b) => b.gap - a.gap || a.id - b.id);   // easiest first, stable
    const layers = new Map<number, number>();
    let start = 0;
    let covered = 0;
    for (let layer = 0; layer < LAYER_SHARE.length; layer++) {
        covered += LAYER_SHARE[layer];
        const end = layer === LAYER_SHARE.length - 1
            ? sorted.length
            : Math.round(sorted.length * covered);
        for (let i = start; i < end; i++) layers.set(sorted[i].id, layer);
        start = end;
    }
    return layers;
};

/**
 * The next situation to serve: first undone item of the player's current
 * layer, in bank order. A layer the player has emptied without promoting
 * spills UP to the next layer's items (they earned the harder pool the
 * long way), then falls back down before declaring the drill done.
 */
export const pickNext = <T extends { id: number }>(
    items: T[], layers: Map<number, number>, layer: number, done: Set<number>,
): T | null => {
    const order: number[] = [];
    for (let l = layer; l <= TOP_LAYER; l++) order.push(l);
    for (let l = layer - 1; l >= 0; l--) order.push(l);
    for (const l of order) {
        const item = items.find((it) => layers.get(it.id) === l && !done.has(it.id));
        if (item) return item;
    }
    return null;
};

/** Fold one answer into the (layer, recent-window) state. Pure — the
 *  service persists it, tests exercise it. */
export const advanceLayer = (
    prev: { layer?: number; recent?: number[] }, hit: boolean,
): { layer: number; recent: number[]; promoted: boolean } => {
    let layer = prev.layer ?? 0;
    let recent = [...(prev.recent ?? []), hit ? 1 : 0].slice(-LAYER_WINDOW);
    let promoted = false;
    const hits = recent.reduce((a, b) => a + b, 0);
    if (layer < TOP_LAYER && hits >= LAYER_NEED) {
        layer += 1;
        recent = [];
        promoted = true;
    }
    return { layer, recent, promoted };
};
