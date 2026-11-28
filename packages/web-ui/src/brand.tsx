/**
 * Safezone brand mark and wordmark (UI_GUIDELINES.md §13).
 *
 * Geometry:
 * - Outer crest: a crisp security shield framing the estate perimeter.
 * - Inner structure: a pitched community roofline and central gate portal.
 * - Flat fills only (Forest #254D42, Sand #E5D8C7, Charcoal #2E3331, White #FFFFFF) — no gradients or glows.
 */
import { colors, radii, spacing, typography } from '@safezone/design-tokens';

export type BrandMarkTone = 'brand' | 'inverse' | 'mono';

export interface BrandMarkProps {
  /** Pixel size of the square mark (default 28). */
  size?: number;
  /**
   * - `brand`: Forest 500 tile with Sand 300 shield and White inner roofline/gate (default, for light surfaces).
   * - `inverse`: Sand 300 tile with Forest 500 shield (for dark/Forest headers).
   * - `mono`: currentColor shield with cut-out roofline (for single-colour contexts).
   */
  tone?: BrandMarkTone;
  /** Accessible label when rendered standalone without adjacent brand text. */
  label?: string;
}

/** Outer shield path in a 32x32 viewBox. */
export const SAFEZONE_SHIELD_PATH =
  'M16 3.5L26 7.5V15.5C26 22.1 21.6 26.9 16 28.8C10.4 26.9 6 22.1 6 15.5V7.5L16 3.5Z';

/** Inner estate roof and gate path in a 32x32 viewBox. */
export const SAFEZONE_ESTATE_PATH =
  'M16 9.2L9.8 14.2V22.2H13.8V17.4C13.8 16.18 14.78 15.2 16 15.2C17.22 15.2 18.2 16.18 18.2 17.4V22.2H22.2V14.2L16 9.2Z';

export function BrandMark({ size = 28, tone = 'brand', label }: BrandMarkProps) {
  const tileFill =
    tone === 'brand'
      ? colors.brand.primary
      : tone === 'inverse'
        ? colors.brand.secondary
        : 'transparent';
  const shieldFill =
    tone === 'brand'
      ? colors.brand.secondary
      : tone === 'inverse'
        ? colors.brand.primary
        : 'currentColor';
  const innerFill =
    tone === 'brand'
      ? colors.brand.onPrimary
      : tone === 'inverse'
        ? colors.semantic.background
        : colors.semantic.surface;
  const keystoneFill =
    tone === 'brand'
      ? colors.brand.primary
      : tone === 'inverse'
        ? colors.brand.primary
        : 'currentColor';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' }}
    >
      {tone !== 'mono' ? <rect x="0" y="0" width="32" height="32" rx="8" fill={tileFill} /> : null}
      <path d={SAFEZONE_SHIELD_PATH} fill={shieldFill} />
      <path d={SAFEZONE_ESTATE_PATH} fill={innerFill} />
      <circle cx="16" cy="13.2" r="1.3" fill={keystoneFill} />
    </svg>
  );
}

export interface BrandLogoProps {
  /** Primary wordmark text (default "Safezone"). */
  name?: string;
  /** Optional surface badge or subtitle (e.g. "Admin", "Vendor Portal"). */
  subtitle?: string;
  /** Mark size in px (default 28). */
  size?: number;
  /** Colour treatment for light vs dark backgrounds. */
  tone?: 'default' | 'inverse';
}

/** Combined Safezone mark + wordmark lockup for headers, sidebars and sign-in screens. */
export function BrandLogo({
  name = 'Safezone',
  subtitle,
  size = 28,
  tone = 'default',
}: BrandLogoProps) {
  const textColor = tone === 'inverse' ? colors.brand.onPrimary : colors.brand.primary;
  const badgeBg = tone === 'inverse' ? colors.brand.secondary : colors.brand.primarySubtle;
  const badgeColor = tone === 'inverse' ? colors.brand.onSecondary : colors.brand.primary;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: spacing[2],
        color: textColor,
        fontFamily: typography.fontFamily.sans,
        fontWeight: Number(typography.weight.bold),
        fontSize: typography.size.lg,
        lineHeight: typography.lineHeight.tight,
        letterSpacing: '-0.02em',
        textDecoration: 'none',
      }}
    >
      <BrandMark size={size} tone={tone === 'inverse' ? 'inverse' : 'brand'} />
      <span>{name}</span>
      {subtitle ? (
        <span
          style={{
            background: badgeBg,
            color: badgeColor,
            borderRadius: radii.sm,
            padding: `2px ${spacing[2]}px`,
            fontSize: typography.size.xs,
            fontWeight: Number(typography.weight.semibold),
            letterSpacing: 0,
          }}
        >
          {subtitle}
        </span>
      ) : null}
    </span>
  );
}
