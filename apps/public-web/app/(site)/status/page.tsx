import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import type { Metadata } from 'next';
import { PageTitle, Prose } from '../../../src/components/site-shell';
import { site } from '../../../src/site';

export const metadata: Metadata = {
  title: 'Service status',
  description: 'Live status of the Safezone service.',
  robots: { index: false, follow: true },
};

/** Re-check at most once a minute (public-web.md §3 /status). */
export const revalidate = 60;

type State = 'ok' | 'down' | 'unknown';

async function check(path: string): Promise<{ state: State; body: unknown }> {
  try {
    const response = await fetch(new URL(path, site.apiUrl), {
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 60 },
    });
    const body: unknown = await response.json().catch(() => null);
    return { state: response.ok ? 'ok' : 'down', body };
  } catch {
    return { state: 'unknown', body: null };
  }
}

function databaseState(ready: { state: State; body: unknown }): State {
  if (ready.state === 'unknown') return 'unknown';
  const data = (ready.body as { data?: { checks?: { database?: string } } } | null)?.data;
  if (data?.checks?.database === 'ok') return 'ok';
  return ready.state === 'ok' ? 'unknown' : 'down';
}

const LOOK: Record<State, { label: string; color: string; background: string }> = {
  ok: {
    label: t('public.status.ok'),
    color: colors.statusSubtle.success.text,
    background: colors.statusSubtle.success.background,
  },
  down: {
    label: t('public.status.down'),
    color: colors.statusSubtle.danger.text,
    background: colors.statusSubtle.danger.background,
  },
  unknown: {
    label: t('public.status.unknown'),
    color: colors.statusSubtle.warning.text,
    background: colors.statusSubtle.warning.background,
  },
};

/** Real checks of the API's public health probes; nothing on this page is hard-coded as "up". */
export default async function StatusPage() {
  const [live, ready] = await Promise.all([check('/health/live'), check('/health/ready')]);
  const rows: { name: string; state: State }[] = [
    { name: t('public.status.api'), state: live.state },
    { name: t('public.status.database'), state: databaseState(ready) },
  ];
  const checkedAt = new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(new Date());

  return (
    <>
      <PageTitle title={t('public.status.title')} lead={t('public.status.lead')} />
      <ul
        style={{ listStyle: 'none', padding: 0, maxWidth: 560, display: 'grid', gap: spacing[2] }}
      >
        {rows.map((row) => (
          <li
            key={row.name}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: spacing[3],
              borderRadius: radii.md,
              background: colors.semantic.surface,
              border: `1px solid ${colors.semantic.border}`,
            }}
          >
            <span style={{ fontWeight: Number(typography.weight.semibold) }}>{row.name}</span>
            <span
              style={{
                padding: `2px ${spacing[2]}px`,
                borderRadius: radii.pill,
                color: LOOK[row.state].color,
                background: LOOK[row.state].background,
                fontWeight: Number(typography.weight.semibold),
              }}
            >
              {LOOK[row.state].label}
            </span>
          </li>
        ))}
      </ul>
      <Prose>
        <p style={{ color: colors.semantic.textMuted }}>
          {t('public.status.checkedAt', { time: checkedAt })}
        </p>
        <p>{t('public.status.note', { email: site.contact.support })}</p>
      </Prose>
    </>
  );
}
