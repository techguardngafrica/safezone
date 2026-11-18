import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
} from 'react';
import type { SessionController, SessionState } from '@safezone/auth';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { type MessageKey, t } from '@safezone/i18n';
import { normalizeNigerianPhone } from '@safezone/schemas';
import { Button } from './index';

/** Reads a SessionController in React. */
export function useSession(controller: SessionController): SessionState {
  return useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
}

/** Error text for an API error code, falling back to a generic message. */
export function authErrorText(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const key = `auth.error.${code}` as MessageKey;
  const text = t(key);
  return text === key ? t('auth.error.UNKNOWN') : text;
}

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  helper?: string;
  error?: string;
  type?: 'text' | 'tel';
  inputMode?: 'text' | 'tel' | 'numeric';
  autoComplete?: string;
  prefix?: string;
  maxLength?: number;
  autoFocus?: boolean;
  monospace?: boolean;
}

/** Text field with a persistent label, helper and error text (UI_GUIDELINES §6.3). */
export function TextField(props: TextFieldProps) {
  const id = useId();
  const describedBy = props.error ? `${id}-error` : props.helper ? `${id}-helper` : undefined;
  return (
    <div style={{ display: 'grid', gap: spacing[1] }}>
      <label
        htmlFor={id}
        style={{ fontSize: typography.size.sm, fontWeight: Number(typography.weight.medium) }}
      >
        {props.label}
      </label>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          minHeight: 44,
          background: colors.semantic.surface,
          border: `${props.error ? 2 : 1}px solid ${props.error ? colors.status.danger : colors.semantic.borderStrong}`,
          borderRadius: radii.lg,
          overflow: 'hidden',
        }}
      >
        {props.prefix ? (
          <span
            aria-hidden="true"
            style={{
              padding: `0 ${spacing[3]}px`,
              alignSelf: 'stretch',
              display: 'flex',
              alignItems: 'center',
              background: colors.semantic.surfaceMuted,
              fontSize: typography.size.md,
            }}
          >
            {props.prefix}
          </span>
        ) : null}
        <input
          id={id}
          type={props.type ?? 'text'}
          inputMode={props.inputMode}
          autoComplete={props.autoComplete}
          maxLength={props.maxLength}
          autoFocus={props.autoFocus}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={describedBy}
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            padding: `0 ${spacing[3]}px`,
            minHeight: 44,
            fontSize: typography.size.md,
            color: colors.semantic.text,
            fontFamily: props.monospace ? typography.fontFamily.mono : typography.fontFamily.sans,
            letterSpacing: props.monospace ? 4 : undefined,
          }}
        />
      </div>
      {props.error ? (
        <span
          id={`${id}-error`}
          role="alert"
          style={{ fontSize: typography.size.sm, color: colors.status.danger }}
        >
          {props.error}
        </span>
      ) : props.helper ? (
        <span
          id={`${id}-helper`}
          style={{ fontSize: typography.size.xs, color: colors.semantic.textMuted }}
        >
          {props.helper}
        </span>
      ) : null}
    </div>
  );
}

function TextButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        padding: `${spacing[2]}px 0`,
        color: colors.semantic.link,
        fontWeight: Number(typography.weight.medium),
        fontSize: typography.size.sm,
        cursor: 'pointer',
        textAlign: 'left',
        minHeight: 44,
      }}
    >
      {children}
    </button>
  );
}

function Form({ onSubmit, children }: { onSubmit: () => void; children: ReactNode }) {
  return (
    <form
      noValidate
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit();
      }}
      style={{ display: 'grid', gap: spacing[4] }}
    >
      {children}
    </form>
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
  /** Heading shown above the form, e.g. the app name. */
  title: string;
  intro?: string;
}

/**
 * Phone + OTP sign-in with the MFA steps staff need (UI_GUIDELINES §7.2). Renders nothing once signed in.
 * All copy comes from @safezone/i18n; error codes from the API map to auth.error.* strings.
 */
export function SignInFlow({ controller, title, intro }: SignInFlowProps) {
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
  // Each step has its own code: never carry the SMS code into the authenticator step.
  useEffect(() => {
    setCode('');
    setUseRecovery(false);
  }, [state.status]);

  if (state.status === 'signed_in') return null;

  const wrap = (heading: string, body: ReactNode) => (
    <section
      aria-labelledby="sign-in-heading"
      style={{
        maxWidth: 420,
        margin: `${spacing[7]}px auto`,
        background: colors.semantic.surface,
        border: `1px solid ${colors.semantic.borderSubtle}`,
        borderRadius: radii.lg,
        padding: spacing[6],
        display: 'grid',
        gap: spacing[4],
      }}
    >
      <p
        style={{
          margin: 0,
          color: colors.brand.primary,
          fontWeight: Number(typography.weight.semibold),
        }}
      >
        {title}
      </p>
      <h1
        id="sign-in-heading"
        style={{
          margin: 0,
          fontSize: typography.size.xxl,
          lineHeight: typography.lineHeight.tight,
        }}
      >
        {heading}
      </h1>
      {body}
    </section>
  );

  if (state.status === 'restoring') {
    return wrap(t('auth.signIn'), <p role="status">{t('auth.restoring')}</p>);
  }

  if (state.status === 'signed_out') {
    return wrap(
      t('auth.signIn'),
      <>
        {intro ? <p style={{ margin: 0, color: colors.semantic.textMuted }}>{intro}</p> : null}
        <Form
          onSubmit={() => {
            const normalized = normalizeNigerianPhone(
              phone.startsWith('+') ? phone : `0${phone.replace(/^0/, '')}`,
            );
            if (!normalized) return setPhoneError(t('auth.phone.invalid'));
            setPhoneError(undefined);
            void controller.requestCode(normalized);
          }}
        >
          <TextField
            label={t('auth.phone.label')}
            value={phone}
            onChange={setPhone}
            prefix="+234"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            autoFocus
            helper={t('auth.phone.help')}
            error={phoneError ?? apiError}
          />
          <Button type="submit" disabled={state.busy}>
            {t('auth.sendCode')}
          </Button>
        </Form>
      </>,
    );
  }

  if (state.status === 'code_sent') {
    return wrap(
      t('auth.otp.title'),
      <>
        <p style={{ margin: 0 }}>{t('auth.otp.sent', { phone: state.phone ?? '' })}</p>
        <Form onSubmit={() => void controller.verifyCode(code)}>
          <TextField
            label={t('auth.otp.label')}
            value={code}
            onChange={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            monospace
            error={apiError}
          />
          <Button type="submit" disabled={state.busy || code.length !== 6}>
            {t('auth.verify')}
          </Button>
        </Form>
        {resendLeft > 0 ? (
          <p
            role="status"
            style={{ margin: 0, fontSize: typography.size.sm, color: colors.semantic.textMuted }}
          >
            {t('auth.otp.resendIn', { seconds: resendLeft })}
          </p>
        ) : (
          <TextButton onClick={() => state.phone && void controller.requestCode(state.phone)}>
            {t('auth.otp.resend')}
          </TextButton>
        )}
        <TextButton
          onClick={() => {
            setCode('');
            controller.restart();
          }}
        >
          {t('auth.otp.changeNumber')}
        </TextButton>
      </>,
    );
  }

  if (state.status === 'mfa_verify') {
    return wrap(
      t('auth.mfa.title'),
      <>
        <p style={{ margin: 0 }}>{t('auth.mfa.prompt')}</p>
        <Form
          onSubmit={() =>
            void controller.verifyMfa(useRecovery ? { recoveryCode: code.trim() } : { code })
          }
        >
          <TextField
            label={useRecovery ? t('auth.mfa.recoveryLabel') : t('auth.otp.label')}
            value={code}
            onChange={(value) =>
              setCode(
                useRecovery
                  ? value.toUpperCase().slice(0, 20)
                  : value.replace(/\D/g, '').slice(0, 6),
              )
            }
            inputMode={useRecovery ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            autoFocus
            monospace
            error={apiError}
          />
          <Button type="submit" disabled={state.busy}>
            {t('auth.mfa.verify')}
          </Button>
        </Form>
        <TextButton
          onClick={() => {
            setCode('');
            setUseRecovery((value) => !value);
          }}
        >
          {useRecovery ? t('auth.mfa.useCode') : t('auth.mfa.useRecovery')}
        </TextButton>
      </>,
    );
  }

  if (state.status === 'mfa_enrol') {
    return wrap(
      t('auth.mfa.enrolTitle'),
      <>
        <p style={{ margin: 0 }}>{t('auth.mfa.enrolBody')}</p>
        {state.enrolment ? (
          <>
            <div>
              <div
                style={{
                  fontSize: typography.size.sm,
                  fontWeight: Number(typography.weight.medium),
                }}
              >
                {t('auth.mfa.secretLabel')}
              </div>
              <code
                style={{
                  display: 'block',
                  marginTop: spacing[1],
                  padding: spacing[3],
                  background: colors.semantic.surfaceMuted,
                  borderRadius: radii.md,
                  fontFamily: typography.fontFamily.mono,
                  wordBreak: 'break-all',
                  userSelect: 'all',
                }}
              >
                {state.enrolment.secret.replace(/(.{4})/g, '$1 ').trim()}
              </code>
            </div>
            <a
              href={state.enrolment.otpauthUri}
              style={{ color: colors.semantic.link, fontWeight: Number(typography.weight.medium) }}
            >
              {t('auth.mfa.openApp')}
            </a>
            <Form onSubmit={() => void controller.confirmEnrolment(code)}>
              <TextField
                label={t('auth.otp.label')}
                value={code}
                onChange={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                monospace
                error={apiError}
              />
              <Button type="submit" disabled={state.busy || code.length !== 6}>
                {t('auth.mfa.confirm')}
              </Button>
            </Form>
          </>
        ) : (
          <p role="status">{t('common.loading')}</p>
        )}
      </>,
    );
  }

  // recovery_codes
  return wrap(
    t('auth.mfa.recoveryTitle'),
    <>
      <p style={{ margin: 0 }}>{t('auth.mfa.recoveryBody')}</p>
      <ul
        style={{
          margin: 0,
          padding: spacing[4],
          listStyle: 'none',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: spacing[2],
          background: colors.semantic.surfaceMuted,
          borderRadius: radii.md,
          fontFamily: typography.fontFamily.mono,
        }}
      >
        {(state.recoveryCodes ?? []).map((recoveryCode) => (
          <li key={recoveryCode}>{recoveryCode}</li>
        ))}
      </ul>
      <Button onClick={() => controller.finishEnrolment()}>{t('auth.mfa.recoverySaved')}</Button>
    </>,
  );
}

export interface SessionGateProps extends SignInFlowProps {
  children: ReactNode;
}

/** Restores the session on mount; shows sign-in until the user is fully signed in (MFA included). */
export function SessionGate({ controller, title, intro, children }: SessionGateProps) {
  const state = useSession(controller);
  useEffect(() => {
    if (controller.getState().status === 'restoring') void controller.restore();
  }, [controller]);
  if (state.status !== 'signed_in')
    return <SignInFlow controller={controller} title={title} intro={intro} />;
  return <>{children}</>;
}

/** Top bar line with the signed-in user and a sign-out action. */
export function AccountBar({ controller }: { controller: SessionController }) {
  const state = useSession(controller);
  const name = state.user?.fullName ?? state.user?.phone ?? '';
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: spacing[3],
        flexWrap: 'wrap',
        marginBottom: spacing[5],
      }}
    >
      <span style={{ color: colors.semantic.textMuted }}>{t('home.signedInAs', { name })}</span>
      <Button variant="secondary" onClick={() => void controller.signOut()}>
        {t('auth.signOut')}
      </Button>
    </div>
  );
}
