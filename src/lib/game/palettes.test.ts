import { describe, expect, it } from 'vitest';
import { PALETTES, nearestColorName, paletteById, suitName, textOn } from './palettes';

describe('palette names', () => {
    it('every palette names all four suits', () => {
        for (const p of PALETTES) {
            expect(Object.keys(p.names)).toHaveLength(4);
            for (const n of Object.values(p.names)) expect(n.length).toBeGreaterThan(1);
        }
    });
    it('standard keeps the family words', () => {
        const std = paletteById('standard');
        expect(suitName(std, 'Yellow')).toBe('Yellow');
    });
    it('neon calls the Yellow slot Cyan — a blue chip never says Yellow', () => {
        const neon = paletteById('neon');
        expect(suitName(neon, 'Yellow')).toBe('Cyan');
        expect(suitName(neon, 'Red')).toBe('Magenta');
    });
});

describe('nearestColorName', () => {
    it('names exact library hits', () => {
        expect(nearestColorName('#7fff00')).toBe('Chartreuse');
        expect(nearestColorName('#000000')).toBe('Black');
    });
    it('names near misses sensibly', () => {
        expect(nearestColorName('#dc2828')).toBe('Red');
        expect(nearestColorName('#05b6d6')).toBe('Cyan');
    });
});

describe('textOn', () => {
    it('flips to dark text on light hues', () => {
        expect(textOn('#f0e442')).toBe('#0f2447');   // True Colors yellow
        expect(textOn('#111827')).toBe('#ffffff');
    });
});
