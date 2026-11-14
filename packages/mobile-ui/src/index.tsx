/**
 * @safezone/mobile-ui — shared React Native components for the three Expo apps.
 * Starter components only; grow this into the design system in Phase 0.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type PressableProps } from 'react-native';
import { colors, radii, spacing, touchTarget, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';

type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps extends Omit<PressableProps, 'children'> {
  label: string;
  variant?: ButtonVariant;
  /** Security App screens use the larger 56 px target. */
  large?: boolean;
}

export function Button({
  label,
  variant = 'primary',
  large = false,
  style,
  ...props
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={(state) => [
        styles.button,
        styles[variant],
        { minHeight: large ? touchTarget.security : touchTarget.default },
        state.pressed && styles.pressed,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...props}
    >
      <Text style={[styles.label, variant === 'secondary' && styles.labelSecondary]}>{label}</Text>
    </Pressable>
  );
}

export function Screen({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={styles.screen}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/** Required label on every paid placement (AGENTS.md §6). Never render on blocked screens. */
export function SponsoredBadge() {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{t('common.sponsored')}</Text>
    </View>
  );
}

export function OfflineBanner() {
  return (
    <View style={styles.offline} accessibilityLiveRegion="polite">
      <Text style={styles.offlineText}>{t('common.offline')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radii.md,
    paddingHorizontal: spacing[4],
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: colors.brand.primary },
  secondary: { backgroundColor: colors.brand.secondary },
  danger: { backgroundColor: colors.status.danger },
  pressed: { opacity: 0.85 },
  label: {
    color: colors.brand.onPrimary,
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  labelSecondary: { color: colors.brand.onSecondary },
  screen: {
    flex: 1,
    backgroundColor: colors.semantic.background,
    padding: spacing[5],
    gap: spacing[4],
  },
  title: {
    fontSize: typography.size.xxl,
    fontWeight: typography.weight.bold,
    color: colors.brand.primary,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.sponsored.badgeBackground,
    borderRadius: radii.pill,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
  },
  badgeText: { color: colors.sponsored.badgeText, fontSize: typography.size.xs },
  offline: { backgroundColor: colors.status.warning, padding: spacing[2], borderRadius: radii.sm },
  offlineText: { color: colors.neutral[0], fontSize: typography.size.sm },
});

export * from './sign-in';
