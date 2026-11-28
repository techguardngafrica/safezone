/**
 * Safezone brand mark and lockup for React Native (UI_GUIDELINES.md §13).
 * Uses pure React Native Views so no native SVG dependency is required, keeping the bundle small
 * for low-end Android devices while matching the web vector mark geometry and palette.
 */
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';

export type BrandMarkTone = 'brand' | 'inverse';

export interface BrandMarkProps {
  /** Outer square tile size in dp (default 36). */
  size?: number;
  tone?: BrandMarkTone;
  /** Accessible label when rendered standalone. */
  label?: string;
}

export function BrandMark({ size = 36, tone = 'brand', label }: BrandMarkProps) {
  const tileBg = tone === 'brand' ? colors.brand.primary : colors.brand.secondary;
  const shieldBg = tone === 'brand' ? colors.brand.secondary : colors.brand.primary;
  const innerBg = tone === 'brand' ? colors.brand.onPrimary : colors.semantic.background;
  const radius = Math.round(size * 0.25);
  const shieldW = Math.round(size * 0.62);
  const shieldH = Math.round(size * 0.72);
  const roofSize = Math.round(size * 0.26);
  const houseW = Math.round(size * 0.34);
  const houseH = Math.round(size * 0.26);
  const archW = Math.max(4, Math.round(size * 0.12));
  const archH = Math.max(6, Math.round(size * 0.17));

  return (
    <View
      accessible={Boolean(label)}
      accessibilityRole={label ? 'image' : undefined}
      accessibilityLabel={label}
      importantForAccessibility={label ? 'yes' : 'no-hide-descendants'}
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: tileBg,
        },
      ]}
    >
      {/* Shield crest */}
      <View
        style={{
          width: shieldW,
          height: shieldH,
          backgroundColor: shieldBg,
          borderTopLeftRadius: Math.round(shieldW * 0.22),
          borderTopRightRadius: Math.round(shieldW * 0.22),
          borderBottomLeftRadius: Math.round(shieldW * 0.5),
          borderBottomRightRadius: Math.round(shieldW * 0.5),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Pitched roof */}
        <View
          style={{
            width: roofSize,
            height: roofSize,
            backgroundColor: innerBg,
            transform: [{ rotate: '45deg' }],
            borderTopLeftRadius: 2,
            marginBottom: -Math.round(roofSize * 0.52),
          }}
        />
        {/* Estate portal body */}
        <View
          style={{
            width: houseW,
            height: houseH,
            backgroundColor: innerBg,
            borderBottomLeftRadius: 2,
            borderBottomRightRadius: 2,
            alignItems: 'center',
            justifyContent: 'flex-end',
          }}
        >
          {/* Gate archway */}
          <View
            style={{
              width: archW,
              height: archH,
              backgroundColor: shieldBg,
              borderTopLeftRadius: archW,
              borderTopRightRadius: archW,
            }}
          />
        </View>
      </View>
    </View>
  );
}

export interface BrandLogoProps {
  name?: string;
  subtitle?: string;
  size?: number;
  large?: boolean;
}

export function BrandLogo({
  name = 'Safezone',
  subtitle,
  size = 32,
  large = false,
}: BrandLogoProps) {
  return (
    <View style={styles.lockup}>
      <BrandMark size={size} />
      <Text style={[styles.wordmark, large && styles.wordmarkLarge]}>{name}</Text>
      {subtitle ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{subtitle}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  wordmark: {
    color: colors.brand.primary,
    fontWeight: typography.weight.bold,
    fontSize: typography.size.lg,
    letterSpacing: -0.3,
  },
  wordmarkLarge: {
    fontSize: typography.size.xl,
  },
  badge: {
    backgroundColor: colors.brand.primarySubtle,
    borderRadius: radii.sm,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
  },
  badgeText: {
    color: colors.brand.primary,
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
  },
});
