// Table color themes. The table starts blue; once trump is called the whole
// table takes on the trump color — the background IS the trump indicator.

import { Suit } from '@/lib/game/types';
import { CardPalette, luminance, shade } from '@/lib/game/palettes';

export interface TableTheme {
    /** page background behind the table */
    bg: string;
    /** the felt circle + compass pointer (a darker shade of bg) */
    felt: string;
    /** tailwind text class for the embossed rook on the felt */
    emboss: string;
}

export const DEFAULT_THEME: TableTheme = { bg: '#1e40af', felt: '#152c7a', emboss: 'text-black/30' };

export const TRUMP_THEMES: Record<Suit, TableTheme> = {
    Red:    { bg: '#991b1b', felt: '#671111', emboss: 'text-black/30' },
    Yellow: { bg: '#ca8a04', felt: '#8f6204', emboss: 'text-black/30' },
    // near-black felt: a dark emboss vanishes, so raise it in white instead
    Black:  { bg: '#27272a', felt: '#111113', emboss: 'text-white/10' },
    Green:  { bg: '#166534', felt: '#0d4527', emboss: 'text-black/30' },
};

export const themeFor = (trump: Suit | null): TableTheme =>
    trump ? TRUMP_THEMES[trump] : DEFAULT_THEME;

/** Palette-aware table theme. Standard keeps the hand-tuned shades the
 *  family knows; other palettes derive bg/felt by darkening the suit
 *  hue (with a floor so a pure-black suit still reads as a charcoal
 *  table, not a void). */
export const themeForPalette = (trump: Suit | null, palette: CardPalette): TableTheme => {
    if (!trump) return DEFAULT_THEME;
    if (palette.id === 'standard') return TRUMP_THEMES[trump];
    const hue = palette.suits[trump];
    if (luminance(hue) < 0.08) {
        return { bg: '#27272a', felt: '#111113', emboss: 'text-white/10' };
    }
    const bg = shade(hue, 0.72);
    const felt = shade(hue, 0.45);
    return { bg, felt, emboss: luminance(felt) < 0.12 ? 'text-white/10' : 'text-black/30' };
};
