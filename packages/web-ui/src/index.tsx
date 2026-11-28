/**
 * @safezone/web-ui — shared components for the Next.js apps.
 * Starter components only; grow this into the design system in Phase 0.
 */
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';

type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const buttonStyles: Record<ButtonVariant, CSSProperties> = {
  primary: { background: colors.brand.primary, color: colors.brand.onPrimary, border: 'none' },
  secondary: {
    background: colors.brand.secondary,
    color: colors.brand.onSecondary,
    border: 'none',
  },
  danger: { background: colors.status.danger, color: colors.neutral[0], border: 'none' },
};

export function Button({ variant = 'primary', style, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      style={{
        ...buttonStyles[variant],
        borderRadius: radii.md,
        padding: `${spacing[2]}px ${spacing[4]}px`,
        fontSize: typography.size.md,
        fontWeight: Number(typography.weight.semibold),
        minHeight: 40,
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.6 : 1,
        ...style,
      }}
      {...props}
    />
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section
      style={{
        background: colors.semantic.surface,
        border: `1px solid ${colors.semantic.borderSubtle}`,
        borderRadius: radii.lg,
        padding: spacing[5],
      }}
    >
      {title ? (
        <h2
          style={{
            margin: 0,
            marginBottom: spacing[3],
            fontSize: typography.size.lg,
            color: colors.brand.primary,
          }}
        >
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

/** Required label on every paid placement (AGENTS.md §6). */
export function SponsoredBadge() {
  return (
    <span
      style={{
        background: colors.sponsored.badgeBackground,
        color: colors.sponsored.badgeText,
        borderRadius: radii.pill,
        padding: `2px ${spacing[2]}px`,
        fontSize: typography.size.xs,
        fontWeight: Number(typography.weight.medium),
      }}
    >
      {t('common.sponsored')}
    </span>
  );
}

export function PageShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main
      style={{
        fontFamily: typography.fontFamily.sans,
        color: colors.semantic.text,
        background: colors.semantic.background,
        minHeight: '100vh',
        padding: spacing[6],
      }}
    >
      <h1 style={{ marginTop: 0, fontSize: typography.size.xxl, color: colors.brand.primary }}>
        {title}
      </h1>
      {children}
    </main>
  );
}

export * from './brand';
export * from './sign-in';
export * from './styles';
export * from './icons';
export * from './layout';
export * from './data';
export * from './forms';
export * from './overlay';
