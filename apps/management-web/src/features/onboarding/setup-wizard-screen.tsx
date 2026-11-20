'use client';

import { unwrap } from '@safezone/api-client';
import { type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  ErrorState,
  PageHeader,
  Panel,
  Skeleton,
  StatusPill,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { api } from '../../../lib/session';

type SetupStep =
  'profile' | 'spaces' | 'gates' | 'security_supervisor' | 'sos_policy' | 'residents';

const STEP_ROUTES: Record<SetupStep, string> = {
  profile: 'settings/estate',
  spaces: 'estate/spaces',
  gates: 'estate/gates',
  security_supervisor: 'people/staff',
  sos_policy: 'settings/estate',
  residents: 'estate/import',
};

export function SetupWizardScreen() {
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
    onSuccess: (data) => {
      queryClient.setQueryData(['estate', estateId, 'setup-progress'], data);
    },
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

  if (progress.isPending) {
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <Skeleton height={48} width="45%" />
        <Skeleton height={240} />
      </div>
    );
  }
  if (progress.isError) {
    return (
      <ErrorState message={errorText(progress.error)} onRetry={() => void progress.refetch()} />
    );
  }

  const { steps, canActivate, estateStatus } = progress.data;
  const completedCount = steps.filter((s) => Boolean(s.completedAt)).length;

  return (
    <>
      <PageHeader
        title={t('wizard.title')}
        description={t('wizard.description')}
        actions={
          estateStatus !== 'active' ? (
            <ActionButton
              disabled={!canActivate}
              busy={activate.isPending}
              onClick={() => activate.mutate()}
            >
              {t('wizard.activate')}
            </ActionButton>
          ) : null
        }
      />

      {estateStatus === 'active' ? (
        <Banner tone="success">{t('wizard.activeBanner')}</Banner>
      ) : null}
      {activate.isError ? <Banner tone="danger">{errorText(activate.error)}</Banner> : null}
      {complete.isError ? <Banner tone="danger">{errorText(complete.error)}</Banner> : null}

      <Panel title={`${completedCount} / ${steps.length} completed`}>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
          {steps.map((step) => {
            const done = Boolean(step.completedAt);
            const route = STEP_ROUTES[step.step];
            return (
              <li
                key={step.step}
                className="sz-card"
                style={{
                  padding: 16,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <StatusPill
                    tone={done ? 'success' : step.required ? 'warning' : 'neutral'}
                    icon={done ? 'check' : 'clock'}
                    label={done ? t('dashboard.setup.done') : t('dashboard.setup.todo')}
                  />
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {t(`wizard.step.${step.step}` as MessageKey)}
                    </div>
                    <div className="sz-muted" style={{ fontSize: 13 }}>
                      {step.required ? 'Required to go live' : t('mw.setup_wizard.optional')}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Link href={`/${estateId}/${route}`} className="sz-btn sz-btn-outline sz-btn-sm">
                    {t('wizard.openScreen')}
                  </Link>
                  {!done ? (
                    <ActionButton
                      variant="secondary"
                      size="sm"
                      busy={complete.isPending && complete.variables === step.step}
                      onClick={() => complete.mutate(step.step)}
                    >
                      {t('wizard.markDone')}
                    </ActionButton>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </Panel>
    </>
  );
}
