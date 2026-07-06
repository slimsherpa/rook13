// Table color themes. The table starts blue; once trump is called the whole
// table takes on the trump color — the background IS the trump indicator.

import { Suit } from '@/lib/game/types';

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
