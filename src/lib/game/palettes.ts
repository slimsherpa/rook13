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
    /** what each suit is CALLED on this device — Paige's law: if the
     *  color is blue, the trump button had better not say Yellow. The
     *  engine still deals in Red/Yellow/Black/Green; these are display
     *  names only. */
    names: Record<Suit, string>;
}

export const PALETTES: CardPalette[] = [
    {
        id: 'standard', name: 'Standard', blurb: 'The family classic',
        suits: { Red: '#dc2626', Yellow: '#eab308', Black: '#111827', Green: '#16a34a' },
        names: { Red: 'Red', Yellow: 'Yellow', Black: 'Black', Green: 'Green' },
    },
    {
        id: 'neon', name: 'Neon Arcade', blurb: 'Quarters not included',
        suits: { Red: '#d946ef', Yellow: '#06b6d4', Black: '#7c3aed', Green: '#84cc16' },
        names: { Red: 'Magenta', Yellow: 'Cyan', Black: 'Violet', Green: 'Lime' },
    },
    {
        id: 'bubblegum', name: 'Bubblegum', blurb: 'Sweet and loud',
        suits: { Red: '#db2777', Yellow: '#8b5cf6', Black: '#0ea5e9', Green: '#10b981' },
        names: { Red: 'Pink', Yellow: 'Grape', Black: 'Sky', Green: 'Mint' },
    },
    {
        id: 'spooky', name: 'Spooky Season', blurb: 'Pumpkins and potions',
        suits: { Red: '#ea580c', Yellow: '#7e22ce', Black: '#18181b', Green: '#65a30d' },
        names: { Red: 'Pumpkin', Yellow: 'Potion', Black: 'Midnight', Green: 'Slime' },
    },
    {
        id: 'beach', name: 'Beach Day', blurb: 'Surf, sand, palms, driftwood',
        suits: { Red: '#0284c7', Yellow: '#d97706', Black: '#334155', Green: '#059669' },
        names: { Red: 'Surf', Yellow: 'Sand', Black: 'Driftwood', Green: 'Palm' },
    },
    {
        id: 'cabin', name: 'Cabin in the Woods', blurb: 'Brick, mustard, bark, moss',
        suits: { Red: '#7f1d1d', Yellow: '#a16207', Black: '#292524', Green: '#3f6212' },
        names: { Red: 'Brick', Yellow: 'Mustard', Black: 'Bark', Green: 'Moss' },
    },
    {
        id: 'royal', name: 'Royal Court', blurb: 'Burgundy, gold, midnight, forest',
        suits: { Red: '#9f1239', Yellow: '#b45309', Black: '#312e81', Green: '#065f46' },
        names: { Red: 'Burgundy', Yellow: 'Gold', Black: 'Midnight', Green: 'Forest' },
    },
    {
        id: 'truecolors', name: 'True Colors', blurb: 'Colorblind-friendly (red-green safe)',
        suits: { Red: '#d55e00', Yellow: '#f0e442', Black: '#000000', Green: '#0072b2' },
        names: { Red: 'Vermillion', Yellow: 'Yellow', Black: 'Black', Green: 'Blue' },
    },
    {
        id: 'fireice', name: 'Fire & Ice', blurb: 'Two hot suits, two cold ones',
        suits: { Red: '#dc2626', Yellow: '#f97316', Black: '#4f46e5', Green: '#0891b2' },
        names: { Red: 'Ember', Yellow: 'Flame', Black: 'Frost', Green: 'Ice' },
    },
    {
        id: 'miami', name: 'Miami Nights', blurb: 'Flamingo, surf, midnight, sun',
        suits: { Red: '#db2777', Yellow: '#06b6d4', Black: '#312e81', Green: '#f59e0b' },
        names: { Red: 'Flamingo', Yellow: 'Surf', Black: 'Midnight', Green: 'Sun' },
    },
];

/** What this device calls a suit under its palette. */
export const suitName = (palette: CardPalette, suit: Suit): string =>
    palette.names[suit];

// ---- the custom palette ("My Colors") -------------------------------------
// One slot, device-local: the player picks four hues, the SYSTEM names
// them (nearest match from the library below). Stored beside the other
// settings; selecting id 'custom' uses it until they pick something else.

const CUSTOM_KEY = 'rook13-custom-palette';
// must match EVT in lib/settings.ts — the shared settings event bus
const SETTINGS_EVT = 'rook13-speed-change';

export const DEFAULT_CUSTOM: Record<Suit, string> =
    { Red: '#e11d48', Yellow: '#f59e0b', Black: '#1e293b', Green: '#0d9488' };

export const getCustomSuits = (): Record<Suit, string> => {
    if (typeof window === 'undefined') return DEFAULT_CUSTOM;
    try {
        const raw = window.localStorage.getItem(CUSTOM_KEY);
        return raw ? { ...DEFAULT_CUSTOM, ...JSON.parse(raw) } : DEFAULT_CUSTOM;
    } catch {
        return DEFAULT_CUSTOM;
    }
};

export const setCustomSuits = (suits: Record<Suit, string>): void => {
    window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(suits));
    window.dispatchEvent(new Event(SETTINGS_EVT));
};

export const customPalette = (): CardPalette => {
    const suits = getCustomSuits();
    const names = {
        Red: nearestColorName(suits.Red),
        Yellow: nearestColorName(suits.Yellow),
        Black: nearestColorName(suits.Black),
        Green: nearestColorName(suits.Green),
    };
    return {
        id: 'custom', name: 'My Colors',
        blurb: `${names.Red} · ${names.Yellow} · ${names.Black} · ${names.Green}`,
        suits, names,
    };
};

export const paletteById = (id: string | null | undefined): CardPalette =>
    id === 'custom' ? customPalette()
        : PALETTES.find((p) => p.id === id) ?? PALETTES[0];

// ---- the color-name library -----------------------------------------------
// Curated from the CSS extended color list plus a few family favorites.
// nearestColorName() names any hex the picker can produce — "the system
// picks the name" (Riley's rule), so a custom suit is always announceable:
// "Chartreuse Trump" beats "#7fff00 Trump".

const COLOR_NAMES: Array<[string, string]> = [
    ['Black', '#000000'], ['Charcoal', '#36454f'], ['Slate', '#708090'],
    ['Silver', '#c0c0c0'], ['Gray', '#808080'], ['Graphite', '#251607'],
    ['White', '#ffffff'], ['Ivory', '#fffff0'], ['Linen', '#faf0e6'],
    ['Maroon', '#800000'], ['Dark Red', '#8b0000'], ['Brick', '#b22222'],
    ['Crimson', '#dc143c'], ['Red', '#dc2626'], ['Scarlet', '#ff2400'],
    ['Tomato', '#ff6347'], ['Coral', '#ff7f50'], ['Salmon', '#fa8072'],
    ['Rose', '#ff007f'], ['Ruby', '#e0115f'], ['Cherry', '#de3163'],
    ['Burgundy', '#800020'], ['Wine', '#722f37'], ['Rust', '#b7410e'],
    ['Vermillion', '#d55e00'], ['Ember', '#c21807'],
    ['Orange', '#ff8c00'], ['Pumpkin', '#ea580c'], ['Tangerine', '#f28500'],
    ['Apricot', '#fbceb1'], ['Peach', '#ffcba4'], ['Amber', '#ffbf00'],
    ['Marigold', '#eaa221'], ['Honey', '#eb9605'], ['Sand', '#d2b48c'],
    ['Gold', '#ffd700'], ['Mustard', '#e1ad01'], ['Yellow', '#eab308'],
    ['Lemon', '#fff44f'], ['Banana', '#ffe135'], ['Butter', '#fffd74'],
    ['Khaki', '#f0e68c'], ['Chartreuse', '#7fff00'], ['Lime', '#84cc16'],
    ['Slime', '#65a30d'], ['Olive', '#808000'], ['Moss', '#8a9a5b'],
    ['Pear', '#d1e231'], ['Pistachio', '#93c572'],
    ['Green', '#16a34a'], ['Kelly Green', '#4cbb17'], ['Grass', '#7cfc00'],
    ['Shamrock', '#009e60'], ['Emerald', '#50c878'], ['Jade', '#00a86b'],
    ['Mint', '#3eb489'], ['Seafoam', '#93e9be'], ['Sage', '#9caf88'],
    ['Fern', '#4f7942'], ['Forest', '#228b22'], ['Hunter Green', '#355e3b'],
    ['Pine', '#01796f'], ['Evergreen', '#05472a'],
    ['Teal', '#008080'], ['Turquoise', '#40e0d0'], ['Aqua', '#00ffff'],
    ['Cyan', '#06b6d4'], ['Lagoon', '#0d98ba'], ['Ice', '#0891b2'],
    ['Sky', '#38bdf8'], ['Azure', '#007fff'], ['Cerulean', '#2a52be'],
    ['Blue', '#2563eb'], ['Royal Blue', '#4169e1'], ['Cobalt', '#0047ab'],
    ['Sapphire', '#0f52ba'], ['Navy', '#000080'], ['Midnight', '#191970'],
    ['Denim', '#1560bd'], ['Steel Blue', '#4682b4'], ['Surf', '#0284c7'],
    ['Periwinkle', '#ccccff'], ['Indigo', '#4b0082'], ['Frost', '#4f46e5'],
    ['Violet', '#7c3aed'], ['Purple', '#800080'], ['Grape', '#6f2da8'],
    ['Plum', '#8e4585'], ['Lavender', '#b57edc'], ['Lilac', '#c8a2c8'],
    ['Amethyst', '#9966cc'], ['Orchid', '#da70d6'], ['Mauve', '#cc79a7'],
    ['Eggplant', '#614051'], ['Potion', '#7e22ce'],
    ['Magenta', '#d946ef'], ['Fuchsia', '#ff00ff'], ['Hot Pink', '#ff69b4'],
    ['Pink', '#db2777'], ['Flamingo', '#fc8eac'], ['Blush', '#de5d83'],
    ['Bubblegum', '#ffc1cc'], ['Watermelon', '#fc6c85'],
    ['Brown', '#8b4513'], ['Chocolate', '#7b3f00'], ['Coffee', '#6f4e37'],
    ['Caramel', '#af6f09'], ['Bronze', '#cd7f32'], ['Copper', '#b87333'],
    ['Tan', '#d2b48c'], ['Bark', '#59443d'], ['Walnut', '#5c4033'],
];

/** Name the nearest library color ("redmean" weighted RGB distance —
 *  cheap and perceptually decent). */
export const nearestColorName = (color: string): string => {
    const [r, g, b] = rgb(color);
    let best = 'Mystery';
    let bestD = Infinity;
    for (const [name, hexStr] of COLOR_NAMES) {
        const [r2, g2, b2] = rgb(hexStr);
        const rm = (r + r2) / 2;
        const dr = r - r2, dg = g - g2, db = b - b2;
        const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
        if (d < bestD) { bestD = d; best = name; }
    }
    return best;
};

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
