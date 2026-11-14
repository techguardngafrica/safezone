/**
 * @safezone/design-tokens — Safezone brand palette and base scales.
 * Plain numbers and strings so both CSS (web-ui) and React Native (mobile-ui) can consume them.
 *
 * Brand colours:
 *   Forest  #254D42 — primary brand colour (actions, headers, focus)
 *   Sand    #E5D8C7 — secondary surfaces, secondary buttons, highlights
 *   Charcoal #2E3331 — text and dark surfaces
 */

export const palette = {
  forest: {
    50: '#EEF3F1',
    100: '#D5E2DD',
    300: '#7FA095',
    500: '#254D42',
    600: '#1E3F36',
    700: '#18332C',
    900: '#0F211C',
  },
  sand: {
    50: '#FAF7F2',
    100: '#F4EEE6',
    300: '#E5D8C7',
    500: '#CDBBA3',
    700: '#8C7A62',
  },
  charcoal: {
    300: '#CFCBC4',
    500: '#646966',
    700: '#474D4A',
    900: '#2E3331',
  },
} as const;

export const colors = {
  brand: {
    primary: palette.forest[500],
    primaryHover: palette.forest[600],
    primaryPressed: palette.forest[700],
    primarySubtle: palette.forest[50],
    onPrimary: '#FFFFFF',
    secondary: palette.sand[300],
    secondaryHover: palette.sand[500],
    secondarySubtle: palette.sand[100],
    onSecondary: palette.charcoal[900],
    dark: palette.charcoal[900],
    onDark: '#FFFFFF',
  },
  /** Warm neutrals anchored on Charcoal so greys sit well next to Sand. */
  neutral: {
    0: '#FFFFFF',
    50: palette.sand[50],
    100: '#F1ECE4',
    300: palette.charcoal[300],
    500: palette.charcoal[500],
    700: palette.charcoal[700],
    900: palette.charcoal[900],
  },
  /** Role-based aliases — prefer these in components. */
  semantic: {
    background: palette.sand[50],
    surface: '#FFFFFF',
    surfaceMuted: palette.sand[100],
    text: palette.charcoal[900],
    textMuted: palette.charcoal[500],
    border: palette.charcoal[300],
    borderSubtle: '#F1ECE4',
    /** Input and control boundaries. 3:1 or better on white, Sand 50, Sand 100 and neutral 100. */
    borderStrong: '#7E8380',
    focusRing: palette.forest[500],
    link: palette.forest[500],
  },
  /** Status colours. SOS / danger red is reserved for emergencies and DENY decisions. */
  status: {
    success: '#12805C',
    warning: '#B45309',
    danger: '#C81E1E',
    info: '#2B6CB0',
  },
  /** Subtle status fills for badges and banners; text colours are AA against their fill. */
  statusSubtle: {
    success: { background: '#E6F4EE', text: '#0B5C42' },
    warning: { background: '#FDF1E3', text: '#8A3F06' },
    danger: { background: '#FCE9E9', text: '#9B1717' },
    info: { background: '#E8F0F9', text: '#1F4F82' },
  },
  /** Home module tile tones (UI_GUIDELINES.md 4.2). Icon chip holds a white icon. */
  tile: {
    forest: { background: palette.forest[100], chip: palette.forest[500] },
    sand: { background: palette.sand[300], chip: palette.charcoal[700] },
  },
  /** Scrim behind dialogs and sheets: Charcoal 900 at 40 percent. */
  overlay: { scrim: 'rgba(46, 51, 49, 0.4)' },
  /** Security App gate decisions — always paired with an icon and a word, never colour alone. */
  gate: { allow: '#12805C', check: '#B45309', deny: '#C81E1E' },
  sponsored: { badgeBackground: palette.sand[300], badgeText: palette.charcoal[900] },
} as const;

export const spacing = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64 } as const;

export const radii = { none: 0, sm: 4, md: 8, lg: 12, xl: 24, pill: 999 } as const;

/** Motion durations in ms (UI_GUIDELINES.md section 12). Respect reduced motion. */
export const motion = { duration: { fast: 120, base: 200, slow: 300 } } as const;

/** Web breakpoints in px (min-width). */
export const breakpoints = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;

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

export const tokens = {
  palette,
  colors,
  spacing,
  radii,
  typography,
  touchTarget,
  motion,
  breakpoints,
} as const;
export type Tokens = typeof tokens;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of a `#RRGGBB` colour. */
export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Expected a #RRGGBB colour, got "${hex}"`);
  const [r, g, b] = match.slice(1).map((part) => channel(parseInt(part, 16)));
  // Regex guarantees three captured groups.
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}

/** WCAG 2.x contrast ratio between two `#RRGGBB` colours (1–21). */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}
