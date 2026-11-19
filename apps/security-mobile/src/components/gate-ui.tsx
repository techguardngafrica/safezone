import { colors, radii, spacing, touchTarget, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from './icon';

/**
 * Security App building blocks (UI_GUIDELINES §8.4, derived): 56 px minimum targets, body 18, titles 28,
 * weight 500 and up, white and Charcoal surfaces with Forest accents. No ads anywhere in this app.
 */

export function GateTitle({ children }: { children: string }) {
  return (
    <Text accessibilityRole="header" style={styles.title}>
      {children}
    </Text>
  );
}

export function BodyText({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && styles.muted]}>{children}</Text>;
}

/** Large home tile, at least 96 high. */
export function GateTile({
  label,
  icon,
  onPress,
  primary,
  badge,
  wide,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  primary?: boolean;
  badge?: number;
  wide?: boolean;
}) {
  const fg = primary ? colors.brand.onPrimary : colors.semantic.text;
  const a11y = badge !== undefined ? `${label}, ${badge}` : label;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        primary ? styles.tilePrimary : styles.tilePlain,
        wide && styles.tileWide,
        pressed && styles.pressed,
      ]}
    >
      <Icon name={icon} size={primary ? 40 : 32} color={primary ? fg : colors.brand.primary} />
      <Text style={[styles.tileLabel, { color: fg }, primary && styles.tileLabelPrimary]}>
        {label}
      </Text>
      {badge !== undefined ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Big pressable used for decisions and keypads (56 high or more). */
export function BigButton({
  label,
  onPress,
  tone = 'primary',
  icon,
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'outline' | 'danger' | 'light' | 'ghostLight';
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
}) {
  const palette = {
    primary: { bg: colors.brand.primary, fg: colors.brand.onPrimary, border: colors.brand.primary },
    outline: {
      bg: colors.semantic.surface,
      fg: colors.brand.primary,
      border: colors.semantic.borderStrong,
    },
    danger: { bg: colors.status.danger, fg: colors.neutral[0], border: colors.status.danger },
    light: { bg: colors.neutral[0], fg: colors.semantic.text, border: colors.neutral[0] },
    ghostLight: { bg: 'transparent', fg: colors.neutral[0], border: colors.neutral[0] },
  }[tone];
  const inactive = Boolean(disabled || busy);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: Boolean(busy) }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.bigButton,
        { backgroundColor: palette.bg, borderColor: palette.border },
        pressed && styles.pressed,
        inactive && styles.disabled,
      ]}
    >
      {icon ? <Icon name={icon} size={26} color={palette.fg} /> : null}
      <Text style={[styles.bigButtonLabel, { color: palette.fg }]}>
        {busy ? t('common.loading') : label}
      </Text>
    </Pressable>
  );
}

/** Back control for full-screen gate flows. */
export function BackRow({ onBack, label = t('ui.back') }: { onBack: () => void; label?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onBack}
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}
    >
      <Icon name="arrow-back" size={28} color={colors.brand.primary} />
      <Text style={styles.backText}>{label}</Text>
    </Pressable>
  );
}

/** Persistent footer: connection, pending sync count, guard and gate (56 high). */
export function StatusBar({
  online,
  pending,
  guard,
}: {
  online: boolean;
  pending: number;
  guard: string;
}) {
  const state = online ? t('sec.status.online') : t('sec.status.offline');
  const sync = pending > 0 ? ` · ${t('sec.status.toSync', { count: pending })}` : '';
  return (
    <View
      style={[styles.status, !online && styles.statusOffline]}
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${state}${sync}. ${guard}`}
    >
      <Icon
        name={online ? 'cloud-done-outline' : 'cloud-offline-outline'}
        size={24}
        color={online ? colors.status.success : colors.neutral[0]}
      />
      <Text style={[styles.statusText, !online && styles.statusTextOffline]} numberOfLines={1}>
        {state}
        {sync}
      </Text>
      <Text style={[styles.statusGuard, !online && styles.statusTextOffline]} numberOfLines={1}>
        {guard}
      </Text>
    </View>
  );
}

/** Label and value on one line, large type. */
export function Fact({ label, value, light }: { label: string; value: string; light?: boolean }) {
  return (
    <View style={styles.fact}>
      <Text style={[styles.factLabel, light && styles.lightMuted]}>{label}</Text>
      <Text style={[styles.factValue, light && styles.light]}>{value}</Text>
    </View>
  );
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'delete'] as const;

/** Numeric keypad with 72 px keys (gloves). */
export function PinPad({
  value,
  onChange,
  length = 6,
}: {
  value: string;
  onChange: (value: string) => void;
  length?: number;
}) {
  return (
    <View style={{ gap: spacing[4] }}>
      <View
        style={styles.pinDots}
        accessible
        accessibilityLabel={t('sec.pin.digits', { count: value.length })}
      >
        {Array.from({ length }, (_, index) => (
          <View key={index} style={styles.pinCell}>
            <Text style={styles.pinDigit}>{value[index] ?? ''}</Text>
          </View>
        ))}
      </View>
      <View style={styles.keypad}>
        {KEYS.map((key) => {
          const label =
            key === 'clear' ? t('sec.pin.clear') : key === 'delete' ? t('sec.pin.delete') : key;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => {
                if (key === 'clear') onChange('');
                else if (key === 'delete') onChange(value.slice(0, -1));
                else if (value.length < length) onChange(value + key);
              }}
              style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
            >
              {key === 'delete' ? (
                <Icon name="backspace-outline" size={30} />
              ) : (
                <Text style={key === 'clear' ? styles.keyTextSmall : styles.keyText}>
                  {key === 'clear' ? t('sec.pin.clear') : key}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const gateStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral[0] },
  content: { padding: spacing[4], gap: spacing[4] },
});

const styles = StyleSheet.create({
  title: {
    fontSize: typography.size.xxl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  body: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.medium,
    color: colors.semantic.text,
    lineHeight: typography.size.lg * typography.lineHeight.normal,
  },
  muted: { color: colors.semantic.textMuted },
  tile: {
    minHeight: 104,
    flexBasis: '47%',
    flexGrow: 1,
    borderRadius: radii.lg,
    padding: spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
  },
  tileWide: { flexBasis: '100%', minHeight: 132 },
  tilePrimary: { backgroundColor: colors.brand.primary },
  tilePlain: {
    backgroundColor: colors.neutral[0],
    borderWidth: 2,
    borderColor: colors.semantic.border,
  },
  tileLabel: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
    textAlign: 'center',
  },
  tileLabelPrimary: { fontSize: typography.size.xl, fontWeight: typography.weight.bold },
  badge: {
    position: 'absolute',
    top: spacing[2],
    right: spacing[2],
    minWidth: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[2],
  },
  badgeText: {
    color: colors.brand.onPrimary,
    fontSize: typography.size.md,
    fontWeight: typography.weight.bold,
  },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  bigButton: {
    minHeight: touchTarget.security + 8,
    borderRadius: radii.lg,
    borderWidth: 2,
    paddingHorizontal: spacing[4],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
  },
  bigButtonLabel: { fontSize: typography.size.lg, fontWeight: typography.weight.bold },
  back: {
    minHeight: touchTarget.security,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    alignSelf: 'flex-start',
    paddingRight: spacing[3],
  },
  backText: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
    color: colors.brand.primary,
  },
  status: {
    minHeight: touchTarget.security,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.semantic.border,
    backgroundColor: colors.neutral[0],
  },
  statusOffline: { backgroundColor: colors.status.warning, borderTopColor: colors.status.warning },
  statusText: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  statusGuard: {
    flex: 1,
    textAlign: 'right',
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
    color: colors.semantic.textMuted,
  },
  statusTextOffline: { color: colors.neutral[0] },
  fact: { gap: 2 },
  factLabel: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
    color: colors.semantic.textMuted,
  },
  factValue: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  light: { color: colors.neutral[0] },
  lightMuted: { color: colors.neutral[0], opacity: 0.9 },
  pinDots: { flexDirection: 'row', justifyContent: 'center', gap: spacing[2] },
  pinCell: {
    width: 48,
    height: 60,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.semantic.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinDigit: {
    fontSize: typography.size.xxl,
    fontWeight: typography.weight.bold,
    fontFamily: 'monospace',
    color: colors.semantic.text,
  },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  key: {
    flexBasis: '31%',
    flexGrow: 1,
    height: 72,
    borderRadius: radii.lg,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPressed: { backgroundColor: colors.neutral[300] },
  keyText: {
    fontSize: typography.size.display,
    fontWeight: typography.weight.semibold,
    color: colors.semantic.text,
  },
  keyTextSmall: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
    color: colors.semantic.text,
  },
});
