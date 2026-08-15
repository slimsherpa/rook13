// Card color palettes — purely cosmetic, device-local. The suits keep
// their NAMES (Red/Yellow/Black/Green stay the words the family says at
// the table); a palette only changes the paint. Standard is exactly the
// colors the game has always had.
//
// Every hue here is picked to carry the card design: the number text on
// a white face, the points circle, the solid trump face, and (darkened)
// the trump-colored table itself. textOn() flips to dark text on the
// few light hues so nothing ever washes out.

import { Suit } from './types';

export interface CardPalette {
    id: string;
    name: string;
    blurb: string;
    suits: Record<Suit, string>;
}

export const PALETTES: CardPalette[] = [
    {
        id: 'standard', name: 'Standard', blurb: 'The family classic',
        suits: { Red: '#dc2626', Yellow: '#eab308', Black: '#111827', Green: '#16a34a' },
    },
    {
        id: 'neon', name: 'Neon Arcade', blurb: 'Quarters not included',
        suits: { Red: '#d946ef', Yellow: '#06b6d4', Black: '#7c3aed', Green: '#84cc16' },
    },
    {
        id: 'bubblegum', name: 'Bubblegum', blurb: 'Sweet and loud',
        suits: { Red: '#db2777', Yellow: '#8b5cf6', Black: '#0ea5e9', Green: '#10b981' },
    },
    {
        id: 'spooky', name: 'Spooky Season', blurb: 'Pumpkins and potions',
        suits: { Red: '#ea580c', Yellow: '#7e22ce', Black: '#18181b', Green: '#65a30d' },
    },
    {
        id: 'beach', name: 'Beach Day', blurb: 'Surf, sand, palms, driftwood',
        suits: { Red: '#0284c7', Yellow: '#d97706', Black: '#334155', Green: '#059669' },
    },
    {
        id: 'cabin', name: 'Cabin in the Woods', blurb: 'Brick, mustard, bark, moss',
        suits: { Red: '#7f1d1d', Yellow: '#a16207', Black: '#292524', Green: '#3f6212' },
    },
    {
        id: 'royal', name: 'Royal Court', blurb: 'Burgundy, gold, midnight, forest',
        suits: { Red: '#9f1239', Yellow: '#b45309', Black: '#312e81', Green: '#065f46' },
    },
    {
        id: 'truecolors', name: 'True Colors', blurb: 'Colorblind-friendly (red-green safe)',
        suits: { Red: '#d55e00', Yellow: '#f0e442', Black: '#000000', Green: '#0072b2' },
    },
    {
        id: 'fireice', name: 'Fire & Ice', blurb: 'Two hot suits, two cold ones',
        suits: { Red: '#dc2626', Yellow: '#f97316', Black: '#4f46e5', Green: '#0891b2' },
    },
    {
        id: 'miami', name: 'Miami Nights', blurb: 'Flamingo, surf, midnight, sun',
        suits: { Red: '#db2777', Yellow: '#06b6d4', Black: '#312e81', Green: '#f59e0b' },
    },
];

export const paletteById = (id: string | null | undefined): CardPalette =>
    PALETTES.find((p) => p.id === id) ?? PALETTES[0];

// ---- color math -----------------------------------------------------------

const rgb = (hex: string): [number, number, number] => {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

const hex = (r: number, g: number, b: number): string =>
    '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** 0..1 perceived luminance. */
export const luminance = (color: string): number => {
    const [r, g, b] = rgb(color);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

/** Multiply toward black (k < 1) — the trump-table shades. */
export const shade = (color: string, k: number): string => {
    const [r, g, b] = rgb(color);
    return hex(r * k, g * k, b * k);
};

/** Blend toward white — the counter grid's glossy top. */
export const tint = (color: string, k: number): string => {
    const [r, g, b] = rgb(color);
    return hex(r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k);
};

/** Text color that stays readable ON the given hue. */
export const textOn = (color: string): string =>
    luminance(color) > 0.62 ? '#0f2447' : '#ffffff';
