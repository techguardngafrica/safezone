'use client';

import { unwrap, unwrapPage } from '@safezone/api-client';
import { type MessageKey, formatDateTime, startOfTodayWat, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  ErrorState,
  Icon,
  PageHeader,
  Panel,
  Skeleton,
  StatCard,
  StatusPill,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { api } from '../../../lib/session';

type SetupStep =
  'profile' | 'spaces' | 'gates' | 'security_supervisor' | 'sos_policy' | 'residents';

/** Where each setup step is done; null while that screen is still to be built. */
const STEP_LINKS: Record<SetupStep, string | null> = {
  profile: 'settings/estate',
  spaces: 'estate/spaces',
  gates: 'estate/gates',
  security_supervisor: null,
  sos_policy: 'settings/estate',
  residents: 'people/join-requests',
};

/** Steps the API cannot detect from data, so the administrator marks them done. */
const MANUAL_STEPS = new Set<SetupStep>([
  'profile',
  'sos_policy',
  'residents',
  'security_supervisor',
]);

function SetupChecklist() {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const progress = useQuery({
    queryKey: ['estate', estateId, 'setup-progress'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/setup-progress', { params: { path: { estateId } } })),
  });
  const complete = useMutation({
    mutationFn: (step: SetupStep) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/setup-progress/{step}/complete', {
          params: { path: { estateId, step } },
        }),
      ),
    onSuccess: (data) => queryClient.setQueryData(['estate', estateId, 'setup-progress'], data),
  });
  const activate = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/setup-progress/activate', {
          params: { path: { estateId } },
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(['estate', estateId, 'setup-progress'], data);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  if (progress.isPending) return <Skeleton height={160} />;
  if (progress.isError)
    return (
      <ErrorState message={errorText(progress.error)} onRetry={() => void progress.refetch()} />
    );
  const { steps, canActivate, estateStatus } = progress.data;
  const allDone = steps.every((step) => step.completedAt);
  if (estateStatus === 'active' && allDone) return null;

  return (
    <Panel
      title={t('dashboard.setup.title')}
      actions={
        estateStatus !== 'active' ? (
          <ActionButton
            disabled={!canActivate}
            busy={activate.isPending}
            onClick={() => activate.mutate()}
          >
            {t('dashboard.setup.activate')}
          </ActionButton>
        ) : null
      }
    >
      <p className="sz-muted" style={{ marginTop: 0, fontSize: 14 }}>
        {estateStatus === 'active' ? t('dashboard.setup.activeBody') : t('dashboard.setup.body')}
      </p>
      {activate.isError ? <Banner tone="danger">{errorText(activate.error)}</Banner> : null}
      {complete.isError ? <Banner tone="danger">{errorText(complete.error)}</Banner> : null}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {steps.map((step) => {
          const link = STEP_LINKS[step.step];
          const done = Boolean(step.completedAt);
          return (
            <li
              key={step.step}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                minHeight: 44,
                flexWrap: 'wrap',
              }}
            >
              <StatusPill
                tone={done ? 'success' : 'neutral'}
                icon={done ? 'check' : 'clock'}
                label={done ? t('dashboard.setup.done') : t('dashboard.setup.todo')}
              />
              <span style={{ flex: 1, minWidth: 200 }}>
                {t(`dashboard.setup.step.${step.step}` as MessageKey)}
                {step.required ? null : (
                  <span className="sz-muted" style={{ fontSize: 13 }}>
                    {' '}
                    {t('dashboard.setup.optional')}
                  </span>
                )}
              </span>
              {!done && link ? (
                <Link href={`/${estateId}/${link}`} className="sz-btn sz-btn-outline sz-btn-sm">
                  {t('dashboard.setup.go')}
                </Link>
              ) : null}
              {!done && MANUAL_STEPS.has(step.step) ? (
                <ActionButton
                  variant="text"
                  size="sm"
                  busy={complete.isPending && complete.variables === step.step}
                  onClick={() => complete.mutate(step.step)}
                >
                  {t('dashboard.setup.markDone')}
                </ActionButton>
              ) : null}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function countLabel(count: number | undefined, more: boolean): string {
  if (count === undefined) return '-';
  return more ? `${count}+` : String(count);
}

function Stats() {
  const { estateId, can, hasFeature } = useEstate();
  const sos = useQuery({
    queryKey: ['estate', estateId, 'sos', 'active'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/sos', {
          params: { path: { estateId }, query: { status: 'active' } },
        }),
      ),
    enabled: can('sos.respond') && hasFeature('emergency'),
    refetchInterval: 3_000,
  });
  const joins = useQuery({
    queryKey: ['estate', estateId, 'join-requests', 'awaiting_manager', 'count'],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/join-requests', {
          params: { path: { estateId }, query: { status: 'awaiting_manager', limit: 50 } },
        }),
      ),
    enabled: can('resident.approve') && hasFeature('occupancy'),
  });
  const today = startOfTodayWat();
  const gate = useQuery({
    queryKey: ['estate', estateId, 'gate-events', 'today', today],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/gate/events', {
          params: { path: { estateId }, query: { from: today, limit: 100 } },
        }),
      ),
    enabled: can('visitor.log.read') && hasFeature('visitors'),
    refetchInterval: 30_000,
  });
  const entries = gate.data?.items.filter(
    (event) => event.direction === 'in' && event.decision !== 'deny',
  );

  return (
    <div className="sz-grid">
      {can('sos.respond') ? (
        <Link href={`/${estateId}/security/sos`} className="sz-stat-link">
          <StatCard
            icon="siren"
            label={t('dashboard.stat.activeSos')}
            value={sos.data?.length ?? '-'}
          />
        </Link>
      ) : null}
      {can('resident.approve') ? (
        <Link href={`/${estateId}/people/join-requests`} className="sz-stat-link">
          <StatCard
            icon="userCheck"
            label={t('dashboard.stat.joinRequests')}
            value={countLabel(joins.data?.items.length, Boolean(joins.data?.nextCursor))}
          />
        </Link>
      ) : null}
      {can('visitor.log.read') ? (
        <Link href={`/${estateId}/security/visitor-log`} className="sz-stat-link">
          <StatCard
            icon="door"
            label={t('dashboard.stat.entriesToday')}
            value={countLabel(entries?.length, Boolean(gate.data?.nextCursor))}
          />
        </Link>
      ) : null}
    </div>
  );
}

function LatestAnnouncements() {
  const { estateId, hasFeature } = useEstate();
  const list = useQuery({
    queryKey: ['estate', estateId, 'announcements', 'latest'],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/announcements', {
          params: { path: { estateId }, query: { all: 'true', limit: 5 } },
        }),
      ),
    enabled: hasFeature('announcements'),
  });
  if (!hasFeature('announcements')) return null;
  return (
    <Panel
      title={t('dashboard.announcements.title')}
      actions={
        <Link
          href={`/${estateId}/community/announcements`}
          className="sz-btn sz-btn-text sz-btn-sm"
        >
          {t('dashboard.viewAll')}
        </Link>
      }
    >
      {list.isPending ? <Skeleton height={80} /> : null}
      {list.isError ? <p role="alert">{errorText(list.error)}</p> : null}
      {list.data && list.data.items.length === 0 ? (
        <p className="sz-muted" style={{ margin: 0, fontSize: 14 }}>
          {t('dashboard.announcements.empty')}
        </p>
      ) : null}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
        {list.data?.items.map((item) => (
          <li key={item.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <Icon name="megaphone" size={18} />
            <div>
              <strong style={{ fontSize: 14 }}>{item.title}</strong>
              <div className="sz-muted" style={{ fontSize: 13 }}>
                {formatDateTime(item.publishedAt)}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function DashboardScreen() {
  const { estateName, can } = useEstate();
  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.description', { estate: estateName })}
      />
      <div style={{ display: 'grid', gap: 24 }}>
        {can('estate.configure') ? <SetupChecklist /> : null}
        <Stats />
        <LatestAnnouncements />
      </div>
    </>
  );
}
