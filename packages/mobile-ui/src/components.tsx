import { type ReactNode, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, radii, spacing, touchTarget, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';

/* ------------------------------------------------------------------ layout */

export interface ScrollScreenProps {
  children: ReactNode;
  /** Pull to refresh. */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Pinned footer (primary action of a form), kept above the keyboard. */
  footer?: ReactNode;
  edges?: Edge[];
  /** Extra bottom padding, e.g. to clear the floating SOS button. */
  bottomInset?: number;
}

/**
 * Screen body: safe areas, a keyboard-avoiding scroll view (inputs are never covered, AGENTS §6.1),
 * optional pull to refresh and a sticky footer.
 */
export function ScrollScreen({
  children,
  refreshing,
  onRefresh,
  footer,
  edges = ['top', 'left', 'right'],
  bottomInset = 0,
}: ScrollScreenProps) {
  return (
    <SafeAreaView edges={edges} style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: spacing[6] + bottomInset }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={Boolean(refreshing)}
                onRefresh={onRefresh}
                tintColor={colors.brand.primary}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Back row (48 target) plus title and optional subtitle (UI_GUIDELINES §6.10). */
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  backIcon,
  trailing,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backIcon?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <View style={{ gap: spacing[1] }}>
      {onBack || trailing ? (
        <View style={styles.backRow}>
          {onBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('ui.back')}
              onPress={onBack}
              style={styles.iconButton}
              hitSlop={4}
            >
              {backIcon ?? <Text style={styles.backText}>{t('ui.back')}</Text>}
            </Pressable>
          ) : (
            <View />
          )}
          {trailing}
        </View>
      ) : null}
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {action}
    </View>
  );
}

export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  if (!onPress) return <View style={[styles.card, style]}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
    >
      {children}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ buttons */

export type ActionVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'text';

export function ActionButton({
  label,
  onPress,
  variant = 'primary',
  icon,
  busy,
  disabled,
  large,
}: {
  label: string;
  onPress: () => void;
  variant?: ActionVariant;
  icon?: ReactNode;
  busy?: boolean;
  disabled?: boolean;
  large?: boolean;
}) {
  const inactive = Boolean(disabled || busy);
  const textColor =
    variant === 'primary' || variant === 'danger'
      ? colors.brand.onPrimary
      : variant === 'secondary'
        ? colors.brand.onSecondary
        : colors.brand.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: Boolean(busy) }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        buttonVariant[variant],
        { minHeight: large ? touchTarget.security : touchTarget.default },
        pressed && styles.pressed,
        inactive && styles.disabled,
      ]}
    >
      {busy ? <ActivityIndicator color={textColor} /> : icon}
      <Text style={[styles.buttonLabel, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

const buttonVariant = StyleSheet.create({
  primary: { backgroundColor: colors.brand.primary },
  secondary: { backgroundColor: colors.brand.secondary },
  outline: {
    backgroundColor: colors.semantic.surface,
    borderWidth: 1,
    borderColor: colors.semantic.borderStrong,
  },
  danger: { backgroundColor: colors.status.danger },
  text: { backgroundColor: 'transparent' },
});

/* ------------------------------------------------------------------ lists */

export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
}) {
  const body = (
    <>
      {leading ? <View style={styles.leadingChip}>{leading}</View> : null}
      <View style={styles.flex}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {trailing}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {body}
    </Pressable>
  );
}

export type Tone = 'info' | 'neutral' | 'success' | 'warning' | 'danger';

const tones: Record<Tone, { background: string; color: string }> = {
  info: { background: colors.statusSubtle.info.background, color: colors.statusSubtle.info.text },
  neutral: { background: colors.neutral[100], color: colors.neutral[700] },
  success: {
    background: colors.statusSubtle.success.background,
    color: colors.statusSubtle.success.text,
  },
  warning: {
    background: colors.statusSubtle.warning.background,
    color: colors.statusSubtle.warning.text,
  },
  danger: {
    background: colors.statusSubtle.danger.background,
    color: colors.statusSubtle.danger.text,
  },
};

/** Status pill, always text (UI_GUIDELINES §6.8). */
export function StatusPill({ tone, label, icon }: { tone: Tone; label: string; icon?: ReactNode }) {
  return (
    <View style={[styles.pill, { backgroundColor: tones[tone].background }]}>
      {icon}
      <Text style={[styles.pillText, { color: tones[tone].color }]}>{label}</Text>
    </View>
  );
}

export function Banner({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.banner, { backgroundColor: tones[tone].background }]}
    >
      <Text style={[styles.bannerText, { color: tones[tone].color }]}>{children}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ states */

export function EmptyState({
  title,
  body,
  icon,
  action,
}: {
  title: string;
  body?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <View style={styles.state}>
      {icon ? <View style={styles.stateIcon}>{icon}</View> : null}
      <Text style={styles.stateTitle}>{title}</Text>
      {body ? <Text style={styles.stateBody}>{body}</Text> : null}
      {action}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <View style={styles.state} accessibilityRole="alert">
      <Text style={styles.stateTitle}>{t('ui.error.title')}</Text>
      <Text style={styles.stateBody}>{message ?? t('common.error')}</Text>
      {onRetry ? (
        <ActionButton label={t('common.retry')} variant="outline" onPress={onRetry} />
      ) : null}
    </View>
  );
}

/** Skeleton block with a subtle pulse (no shimmer sweep, UI_GUIDELINES §6.14). */
export function Skeleton({
  height = 16,
  width = '100%',
}: {
  height?: number;
  width?: number | `${number}%`;
}) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.55, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[styles.skeleton, { height, width, opacity }]} />;
}

/* ------------------------------------------------------------------ inputs */

export interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  helper?: string;
  error?: string | null;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'phone-pad' | 'number-pad' | 'email-address';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  maxLength?: number;
  autoFocus?: boolean;
  /** Read-only display, e.g. a verified phone number. */
  editable?: boolean;
}

export function TextField(props: TextFieldProps) {
  return (
    <View style={{ gap: spacing[1] }}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        accessibilityLabel={props.label}
        accessibilityHint={props.error ?? props.helper}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={colors.semantic.textMuted}
        multiline={props.multiline}
        keyboardType={props.keyboardType}
        autoCapitalize={props.autoCapitalize}
        maxLength={props.maxLength}
        autoFocus={props.autoFocus}
        editable={props.editable ?? true}
        textAlignVertical={props.multiline ? 'top' : 'center'}
        style={[
          styles.input,
          props.multiline && styles.inputMultiline,
          props.editable === false && styles.inputReadOnly,
          props.error ? styles.inputError : null,
        ]}
      />
      {props.error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {props.error}
        </Text>
      ) : props.helper ? (
        <Text style={styles.helper}>{props.helper}</Text>
      ) : null}
    </View>
  );
}

/** Checkbox with its label as one 48 px touch target. */
export function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={() => onChange(!checked)}
      style={styles.checkRow}
    >
      <View style={[styles.checkBox, checked && styles.checkBoxOn]}>
        {checked ? <Text style={styles.checkMark}>{'\u2713'}</Text> : null}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

/** A setting with a switch; the label and helper are one 48 px row (UI_GUIDELINES §8.1 profile rows). */
export function ToggleRow({
  label,
  helper,
  value,
  onChange,
  disabled,
}: {
  label: string;
  helper?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.flex}>
        <Text style={styles.rowTitle}>{label}</Text>
        {helper ? <Text style={styles.helper}>{helper}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: colors.brand.primary, false: colors.semantic.border }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

/** Chips where several options can be on (e.g. working days). */
export function MultiChipGroup<K extends string>({
  options,
  value,
  onChange,
  label,
  error,
}: {
  options: { key: K; label: string }[];
  value: K[];
  onChange: (keys: K[]) => void;
  label: string;
  error?: string | null;
}) {
  return (
    <View style={{ gap: spacing[2] }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>
        {options.map((option) => {
          const selected = value.includes(option.key);
          return (
            <Pressable
              key={option.key}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={option.label}
              onPress={() =>
                onChange(
                  selected ? value.filter((key) => key !== option.key) : [...value, option.key],
                )
              }
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Segmented control for 2 to 4 options (UI_GUIDELINES §6.10). */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
  label: string;
}) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={styles.segmented}>
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.key)}
            style={[styles.segment, selected && styles.segmentSelected]}
          >
            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Selectable chips (single select). */
export function ChipGroup<K extends string>({
  options,
  value,
  onChange,
  label,
  error,
}: {
  options: { key: K; label: string }[];
  value: K | null;
  onChange: (key: K) => void;
  label: string;
  /** Shown under the chips, e.g. when no option is chosen. */
  error?: string | null;
}) {
  return (
    <View style={{ gap: spacing[2] }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>
        {options.map((option) => {
          const selected = option.key === value;
          return (
            <Pressable
              key={option.key}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(option.key)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ modal */

export interface ConfirmModalProps {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  error?: string | null;
  /** Optional reason field (e.g. revoke). */
  reason?: { label: string; value: string; onChange: (value: string) => void; required?: boolean };
  onConfirm: () => void;
  onCancel: () => void;
}

/** AppConfirmModal (UI_GUIDELINES §6.11): in-app confirm instead of Alert.alert. */
export function ConfirmModal(props: ConfirmModalProps) {
  const blocked = Boolean(props.reason?.required && !props.reason.value.trim());
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.scrim}
      >
        <View style={styles.dialog} accessibilityViewIsModal>
          <Text accessibilityRole="header" style={styles.dialogTitle}>
            {props.title}
          </Text>
          <Text style={styles.dialogBody}>{props.body}</Text>
          {props.reason ? (
            <TextField
              label={props.reason.label}
              value={props.reason.value}
              onChangeText={props.reason.onChange}
              multiline
              autoFocus
            />
          ) : null}
          {props.error ? <Text style={styles.error}>{props.error}</Text> : null}
          <View style={{ gap: spacing[2] }}>
            <ActionButton
              label={props.confirmLabel}
              variant={props.destructive ? 'danger' : 'primary'}
              busy={props.busy}
              disabled={blocked}
              onPress={props.onConfirm}
            />
            <ActionButton
              label={props.cancelLabel ?? t('common.cancel')}
              variant="text"
              onPress={props.onCancel}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ------------------------------------------------------------------ styles */

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.semantic.background },
  scroll: { padding: spacing[4], gap: spacing[4] },
  footer: {
    padding: spacing[4],
    backgroundColor: colors.semantic.surface,
    borderTopWidth: 1,
    borderTopColor: colors.semantic.borderSubtle,
  },
  backRow: {
    minHeight: touchTarget.default,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    minWidth: touchTarget.default,
    minHeight: touchTarget.default,
    justifyContent: 'center',
  },
  backText: { color: colors.semantic.link, fontSize: typography.size.md },
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  subtitle: { fontSize: typography.size.sm, color: colors.semantic.textMuted },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing[2],
  },
  sectionTitle: {
    fontSize: typography.size.sm,
    color: colors.semantic.textMuted,
    fontWeight: typography.weight.semibold,
  },
  card: {
    backgroundColor: colors.semantic.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.semantic.borderSubtle,
    padding: spacing[4],
    gap: spacing[2],
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  button: {
    flexDirection: 'row',
    gap: spacing[2],
    borderRadius: radii.md,
    paddingHorizontal: spacing[4],
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: { fontSize: typography.size.md, fontWeight: typography.weight.semibold },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: 56,
    paddingVertical: spacing[2],
  },
  rowPressed: { backgroundColor: colors.neutral[50] },
  leadingChip: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.brand.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: {
    fontSize: typography.size.md,
    color: colors.semantic.text,
    fontWeight: typography.weight.medium,
  },
  rowSubtitle: { fontSize: typography.size.sm, color: colors.semantic.textMuted },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: spacing[3],
    minHeight: 24,
  },
  pillText: { fontSize: typography.size.xs, fontWeight: typography.weight.medium },
  banner: { borderRadius: radii.md, padding: spacing[3] },
  bannerText: { fontSize: typography.size.sm },
  state: { alignItems: 'center', gap: spacing[2], paddingVertical: spacing[6] },
  stateIcon: {
    width: 64,
    height: 64,
    borderRadius: radii.pill,
    backgroundColor: colors.brand.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[1],
  },
  stateTitle: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
    textAlign: 'center',
  },
  stateBody: {
    fontSize: typography.size.sm,
    color: colors.semantic.textMuted,
    textAlign: 'center',
    maxWidth: 320,
  },
  skeleton: { backgroundColor: colors.semantic.surfaceMuted, borderRadius: radii.sm },
  label: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    color: colors.semantic.text,
  },
  input: {
    minHeight: touchTarget.default,
    backgroundColor: colors.semantic.surface,
    borderWidth: 1,
    borderColor: colors.semantic.borderStrong,
    borderRadius: radii.lg,
    paddingHorizontal: spacing[3],
    fontSize: typography.size.md,
    color: colors.semantic.text,
  },
  inputMultiline: { minHeight: 96, paddingTop: spacing[3] },
  inputReadOnly: {
    backgroundColor: colors.semantic.surfaceMuted,
    color: colors.semantic.textMuted,
  },
  inputError: { borderWidth: 2, borderColor: colors.status.danger },
  helper: { fontSize: typography.size.xs, color: colors.semantic.textMuted },
  error: { fontSize: typography.size.sm, color: colors.status.danger },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: touchTarget.default,
  },
  checkBox: {
    width: 24,
    height: 24,
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: colors.semantic.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxOn: { backgroundColor: colors.brand.primary, borderColor: colors.brand.primary },
  checkMark: { color: colors.brand.onPrimary, fontSize: 16, fontWeight: typography.weight.bold },
  checkLabel: { flex: 1, fontSize: typography.size.sm, color: colors.semantic.text },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: touchTarget.default,
    paddingVertical: spacing[1],
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.semantic.surfaceMuted,
    borderRadius: radii.pill,
    padding: 4,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentSelected: { backgroundColor: colors.semantic.surface },
  segmentText: { fontSize: typography.size.sm, color: colors.semantic.textMuted },
  segmentTextSelected: { color: colors.brand.primary, fontWeight: typography.weight.semibold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  chip: {
    minHeight: 40,
    paddingHorizontal: spacing[3],
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.semantic.borderStrong,
    backgroundColor: colors.semantic.surface,
    justifyContent: 'center',
  },
  chipSelected: { backgroundColor: colors.brand.primarySubtle, borderColor: colors.brand.primary },
  chipText: { fontSize: typography.size.sm, color: colors.semantic.text },
  chipTextSelected: { color: colors.brand.primary, fontWeight: typography.weight.semibold },
  scrim: {
    flex: 1,
    backgroundColor: colors.overlay.scrim,
    justifyContent: 'center',
    padding: spacing[4],
  },
  dialog: {
    backgroundColor: colors.semantic.surface,
    borderRadius: radii.lg,
    padding: spacing[5],
    gap: spacing[3],
    maxWidth: 340,
    width: '100%',
    alignSelf: 'center',
  },
  dialogTitle: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  dialogBody: { fontSize: typography.size.md, color: colors.semantic.text },
});
