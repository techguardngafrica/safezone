/**
 * @safezone/design-tokens — placeholder palette until the design system is defined in Phase 0.
 * Plain numbers and strings so both CSS (web-ui) and React Native (mobile-ui) can consume them.
 */

export const colors = {
  brand: { primary: '#0B5FFF', primaryDark: '#0A3FB3', onPrimary: '#FFFFFF' },
  neutral: {
    0: '#FFFFFF',
    50: '#F6F7F9',
    100: '#EDEFF3',
    300: '#C5CAD3',
    500: '#6B7280',
    700: '#374151',
    900: '#111827',
  },
  /** Status colours. SOS / danger red is reserved for emergencies and DENY decisions. */
  status: {
    success: '#12805C',
    warning: '#B45309',
    danger: '#C81E1E',
    info: '#0B5FFF',
  },
  /** Security App gate decisions — always paired with an icon and a word, never colour alone. */
  gate: { allow: '#12805C', check: '#B45309', deny: '#C81E1E' },
  sponsored: { badgeBackground: '#EDEFF3', badgeText: '#374151' },
} as const;

export const spacing = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64 } as const;

export const radii = { none: 0, sm: 4, md: 8, lg: 12, pill: 999 } as const;

export const typography = {
  fontFamily: {
    sans: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  size: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, xxl: 28, display: 36 },
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  lineHeight: { tight: 1.2, normal: 1.45, relaxed: 1.6 },
} as const;

/** Minimum touch targets (AGENTS.md §7). */
export const touchTarget = { default: 48, security: 56 } as const;

export const tokens = { colors, spacing, radii, typography, touchTarget } as const;
export type Tokens = typeof tokens;
