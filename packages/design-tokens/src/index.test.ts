import { describe, expect, it } from 'vitest';
import { breakpoints, colors, contrastRatio, motion, radii, relativeLuminance } from './index';

const AA_TEXT = 4.5;

describe('brand colours', () => {
  it('uses the confirmed brand palette', () => {
    expect(colors.brand.primary).toBe('#254D42');
    expect(colors.brand.secondary).toBe('#E5D8C7');
    expect(colors.brand.dark).toBe('#2E3331');
  });

  it.each([
    ['onPrimary on primary', colors.brand.onPrimary, colors.brand.primary],
    ['onPrimary on primaryPressed', colors.brand.onPrimary, colors.brand.primaryPressed],
    ['onSecondary on secondary', colors.brand.onSecondary, colors.brand.secondary],
    ['primary on secondary', colors.brand.primary, colors.brand.secondary],
    ['onDark on dark', colors.brand.onDark, colors.brand.dark],
    ['text on background', colors.semantic.text, colors.semantic.background],
    ['textMuted on background', colors.semantic.textMuted, colors.semantic.background],
    ['textMuted on surface', colors.semantic.textMuted, colors.semantic.surface],
    ['link on surface', colors.semantic.link, colors.semantic.surface],
    ['sponsored badge', colors.sponsored.badgeText, colors.sponsored.badgeBackground],
    ['white on danger', colors.neutral[0], colors.status.danger],
    ['white on warning', colors.neutral[0], colors.status.warning],
  ])('%s meets WCAG AA for text', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe('added UI guideline tokens', () => {
  const surfaces = [
    colors.semantic.surface,
    colors.semantic.background,
    colors.semantic.surfaceMuted,
    colors.neutral[100],
  ];

  it.each(surfaces)('borderStrong meets 3:1 non-text contrast on %s', (surface) => {
    expect(contrastRatio(colors.semantic.borderStrong, surface)).toBeGreaterThanOrEqual(3);
  });

  it.each(Object.entries(colors.statusSubtle))(
    '%s subtle text meets AA on its fill',
    (_n, pair) => {
      expect(contrastRatio(pair.text, pair.background)).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  it.each([
    ['forest tile text', colors.semantic.text, colors.tile.forest.background],
    ['sand tile text', colors.semantic.text, colors.tile.sand.background],
    ['forest chip icon', colors.neutral[0], colors.tile.forest.chip],
    ['sand chip icon', colors.neutral[0], colors.tile.sand.chip],
  ])('%s meets AA', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('exposes the sheet radius, motion and breakpoints', () => {
    expect(radii.xl).toBe(24);
    expect(motion.duration).toEqual({ fast: 120, base: 200, slow: 300 });
    expect(breakpoints.xl).toBe(1280);
  });
});

describe('contrastRatio', () => {
  it('returns 21 for black on white and 1 for identical colours', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#254D42', '#254D42')).toBe(1);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#2E3331', '#E5D8C7')).toBe(contrastRatio('#E5D8C7', '#2E3331'));
  });

  it('rejects malformed colours', () => {
    expect(() => relativeLuminance('#FFF')).toThrow();
    expect(() => relativeLuminance('red')).toThrow();
  });
});
