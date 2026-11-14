import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { SessionController, SessionState } from '@safezone/auth';
import { colors, radii, spacing, touchTarget, typography } from '@safezone/design-tokens';
import { type MessageKey, t } from '@safezone/i18n';
import { normalizeNigerianPhone } from '@safezone/schemas';
import { Button } from './index';

export function useSession(controller: SessionController): SessionState {
  return useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
}

export function authErrorText(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const key = `auth.error.${code}` as MessageKey;
  const text = t(key);
  return text === key ? t('auth.error.UNKNOWN') : text;
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  helper?: string;
  error?: string;
  prefix?: string;
  keyboardType?: 'phone-pad' | 'number-pad' | 'default';
  textContentType?: 'telephoneNumber' | 'oneTimeCode' | 'none';
  autoComplete?: 'tel' | 'sms-otp' | 'off';
  maxLength?: number;
  autoFocus?: boolean;
  large?: boolean;
  monospace?: boolean;
}

/** Text field with a persistent label (UI_GUIDELINES §6.3). */
export function Field(props: FieldProps) {
  const height = props.large ? touchTarget.security : touchTarget.default;
  return (
    <View style={{ gap: spacing[1] }}>
      <Text style={[styles.label, props.large && styles.labelLarge]}>{props.label}</Text>
      <View style={[styles.field, { minHeight: height }, props.error ? styles.fieldError : null]}>
        {props.prefix ? (
          <Text
            style={[styles.prefix, props.large && styles.inputLarge]}
            importantForAccessibility="no"
          >
            {props.prefix}
          </Text>
        ) : null}
        <TextInput
          accessibilityLabel={props.label}
          accessibilityHint={props.error ?? props.helper}
          value={props.value}
          onChangeText={props.onChangeText}
          keyboardType={props.keyboardType ?? 'default'}
          textContentType={props.textContentType}
          autoComplete={props.autoComplete}
          maxLength={props.maxLength}
          autoFocus={props.autoFocus}
          style={[
            styles.input,
            { minHeight: height },
            props.large && styles.inputLarge,
            props.monospace && styles.mono,
          ]}
        />
      </View>
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

function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.link} hitSlop={8}>
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

function useCountdown(seconds: number | undefined, key: unknown): number {
  const [left, setLeft] = useState(seconds ?? 0);
  useEffect(() => {
    setLeft(seconds ?? 0);
    if (!seconds) return undefined;
    const timer = setInterval(() => setLeft((value) => (value > 0 ? value - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [seconds, key]);
  return left;
}

export interface SignInFlowProps {
  controller: SessionController;
  title: string;
  intro?: string;
  /** Security App: 56 px targets and larger type. */
  large?: boolean;
}

/** Phone + OTP sign-in with the staff MFA steps (UI_GUIDELINES §7.2). Keyboard never covers inputs. */
export function SignInFlow({ controller, title, intro, large = false }: SignInFlowProps) {
  const state = useSession(controller);
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string>();
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const resendLeft = useCountdown(
    state.status === 'code_sent' ? state.resendAfterSeconds : undefined,
    state.phone,
  );
  const apiError = authErrorText(state.errorCode);

  if (state.status === 'signed_in') return null;

  const wrap = (heading: string, body: ReactNode) => (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>{title}</Text>
        <Text accessibilityRole="header" style={[styles.heading, large && styles.headingLarge]}>
          {heading}
        </Text>
        {body}
      </ScrollView>
    </KeyboardAvoidingView>
  );

  const digits = (value: string, max = 6) => value.replace(/\D/g, '').slice(0, max);

  if (state.status === 'restoring')
    return wrap(t('auth.signIn'), <Text>{t('auth.restoring')}</Text>);

  if (state.status === 'signed_out') {
    return wrap(
      t('auth.signIn'),
      <>
        {intro ? <Text style={styles.muted}>{intro}</Text> : null}
        <Field
          label={t('auth.phone.label')}
          value={phone}
          onChangeText={setPhone}
          prefix="+234"
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          helper={t('auth.phone.help')}
          error={phoneError ?? apiError}
          large={large}
        />
        <Button
          label={t('auth.sendCode')}
          large={large}
          disabled={state.busy}
          onPress={() => {
            const normalized = normalizeNigerianPhone(
              phone.startsWith('+') ? phone : `0${phone.replace(/^0/, '')}`,
            );
            if (!normalized) return setPhoneError(t('auth.phone.invalid'));
            setPhoneError(undefined);
            void controller.requestCode(normalized);
          }}
        />
      </>,
    );
  }

  if (state.status === 'code_sent') {
    return wrap(
      t('auth.otp.title'),
      <>
        <Text>{t('auth.otp.sent', { phone: state.phone ?? '' })}</Text>
        <Field
          label={t('auth.otp.label')}
          value={code}
          onChangeText={(value) => setCode(digits(value))}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={6}
          autoFocus
          monospace
          error={apiError}
          large={large}
        />
        <Button
          label={t('auth.verify')}
          large={large}
          disabled={state.busy || code.length !== 6}
          onPress={() => void controller.verifyCode(code)}
        />
        {resendLeft > 0 ? (
          <Text style={styles.muted}>{t('auth.otp.resendIn', { seconds: resendLeft })}</Text>
        ) : (
          <LinkButton
            label={t('auth.otp.resend')}
            onPress={() => state.phone && void controller.requestCode(state.phone)}
          />
        )}
        <LinkButton
          label={t('auth.otp.changeNumber')}
          onPress={() => {
            setCode('');
            controller.restart();
          }}
        />
      </>,
    );
  }

  if (state.status === 'mfa_verify') {
    return wrap(
      t('auth.mfa.title'),
      <>
        <Text>{t('auth.mfa.prompt')}</Text>
        <Field
          label={useRecovery ? t('auth.mfa.recoveryLabel') : t('auth.otp.label')}
          value={code}
          onChangeText={(value) =>
            setCode(useRecovery ? value.toUpperCase().slice(0, 20) : digits(value))
          }
          keyboardType={useRecovery ? 'default' : 'number-pad'}
          textContentType={useRecovery ? 'none' : 'oneTimeCode'}
          autoFocus
          monospace
          error={apiError}
          large={large}
        />
        <Button
          label={t('auth.mfa.verify')}
          large={large}
          disabled={state.busy}
          onPress={() =>
            void controller.verifyMfa(useRecovery ? { recoveryCode: code.trim() } : { code })
          }
        />
        <LinkButton
          label={useRecovery ? t('auth.mfa.useCode') : t('auth.mfa.useRecovery')}
          onPress={() => {
            setCode('');
            setUseRecovery((value) => !value);
          }}
        />
      </>,
    );
  }

  if (state.status === 'mfa_enrol') {
    const enrolment = state.enrolment;
    return wrap(
      t('auth.mfa.enrolTitle'),
      <>
        <Text>{t('auth.mfa.enrolBody')}</Text>
        {enrolment ? (
          <>
            <Text style={styles.label}>{t('auth.mfa.secretLabel')}</Text>
            <Text selectable style={styles.secret}>
              {enrolment.secret.replace(/(.{4})/g, '$1 ').trim()}
            </Text>
            <LinkButton
              label={t('auth.mfa.openApp')}
              onPress={() => void Linking.openURL(enrolment.otpauthUri).catch(() => undefined)}
            />
            <Field
              label={t('auth.otp.label')}
              value={code}
              onChangeText={(value) => setCode(digits(value))}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              monospace
              error={apiError}
              large={large}
            />
            <Button
              label={t('auth.mfa.confirm')}
              large={large}
              disabled={state.busy || code.length !== 6}
              onPress={() => void controller.confirmEnrolment(code)}
            />
          </>
        ) : (
          <Text>{t('common.loading')}</Text>
        )}
      </>,
    );
  }

  return wrap(
    t('auth.mfa.recoveryTitle'),
    <>
      <Text>{t('auth.mfa.recoveryBody')}</Text>
      <View style={styles.codes}>
        {(state.recoveryCodes ?? []).map((recoveryCode) => (
          <Text key={recoveryCode} selectable style={[styles.mono, styles.codeItem]}>
            {recoveryCode}
          </Text>
        ))}
      </View>
      <Button
        label={t('auth.mfa.recoverySaved')}
        large={large}
        onPress={() => controller.finishEnrolment()}
      />
    </>,
  );
}

export interface SessionGateProps extends SignInFlowProps {
  children: ReactNode;
}

/** Restores the session on start; shows sign-in until fully signed in (MFA included). */
export function SessionGate({ children, ...props }: SessionGateProps) {
  const state = useSession(props.controller);
  useEffect(() => {
    if (props.controller.getState().status === 'restoring') void props.controller.restore();
  }, [props.controller]);
  if (state.status !== 'signed_in') return <SignInFlow {...props} />;
  return <>{children}</>;
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: spacing[5],
    gap: spacing[4],
    backgroundColor: colors.semantic.background,
  },
  brand: {
    color: colors.brand.primary,
    fontWeight: typography.weight.semibold,
    fontSize: typography.size.md,
  },
  heading: {
    fontSize: typography.size.xxl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  headingLarge: { fontSize: typography.size.display },
  label: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    color: colors.semantic.text,
  },
  labelLarge: { fontSize: typography.size.lg },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.semantic.surface,
    borderWidth: 1,
    borderColor: colors.semantic.borderStrong,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  fieldError: { borderWidth: 2, borderColor: colors.status.danger },
  prefix: {
    paddingHorizontal: spacing[3],
    fontSize: typography.size.md,
    color: colors.semantic.text,
    backgroundColor: colors.semantic.surfaceMuted,
    alignSelf: 'stretch',
    textAlignVertical: 'center',
    paddingTop: Platform.OS === 'ios' ? spacing[3] : 0,
  },
  input: {
    flex: 1,
    paddingHorizontal: spacing[3],
    fontSize: typography.size.md,
    color: colors.semantic.text,
  },
  inputLarge: { fontSize: typography.size.lg },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), letterSpacing: 2 },
  helper: { fontSize: typography.size.xs, color: colors.semantic.textMuted },
  error: { fontSize: typography.size.sm, color: colors.status.danger },
  muted: { color: colors.semantic.textMuted },
  link: { minHeight: touchTarget.default, justifyContent: 'center' },
  linkText: {
    color: colors.semantic.link,
    fontWeight: typography.weight.medium,
    fontSize: typography.size.sm,
  },
  secret: {
    padding: spacing[3],
    backgroundColor: colors.semantic.surfaceMuted,
    borderRadius: radii.md,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  codes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    padding: spacing[4],
    backgroundColor: colors.semantic.surfaceMuted,
    borderRadius: radii.md,
  },
  codeItem: { width: '45%' },
});
