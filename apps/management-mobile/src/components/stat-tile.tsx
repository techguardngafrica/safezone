import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from './icon';

/** Dashboard number tile (half width). Tapping opens the list behind the number. */
export function StatTile({
  icon,
  label,
  value,
  alert = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  value: string;
  /** Danger styling, for an active SOS. */
  alert?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <>
      <View style={styles.top}>
        <Icon name={icon} size={20} color={alert ? colors.neutral[0] : colors.brand.primary} />
        <Text style={[styles.value, alert && styles.alertText]}>{value}</Text>
      </View>
      <Text style={[styles.label, alert && styles.alertText]}>{label}</Text>
    </>
  );
  const style = [styles.tile, alert && styles.alert];
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      style={({ pressed }) => [...style, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 96,
    padding: spacing[4],
    gap: spacing[2],
    borderRadius: radii.lg,
    backgroundColor: colors.semantic.surface,
    borderWidth: 1,
    borderColor: colors.semantic.borderSubtle,
  },
  alert: { backgroundColor: colors.status.danger, borderColor: colors.status.danger },
  pressed: { opacity: 0.85 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  value: {
    fontSize: typography.size.xxl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
    fontVariant: ['tabular-nums'],
  },
  label: { fontSize: typography.size.sm, color: colors.semantic.textMuted },
  alertText: { color: colors.neutral[0] },
});
