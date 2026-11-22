'use client';

import { type ApiRow, unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  DataTable,
  ErrorState,
  FormError,
  PageHeader,
  StatusPill,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { usePlatform } from '../../lib/platform';

type Placement = ApiRow<'/v1/platform/ad-placements', 'get'>;

/** Placements inventory (advertising.md §3). */
export function PlacementsScreen() {
  const qc = useQueryClient();
  const { can } = usePlatform();
  const query = useQuery({
    queryKey: ['platform', 'ad-placements'],
    queryFn: () => unwrap(api.GET('/v1/platform/ad-placements')),
  });
  const toggle = useMutation({
    mutationFn: (placement: Placement) =>
      unwrap(
        api.PATCH('/v1/platform/ad-placements/{key}', {
          params: { path: { key: placement.key } },
          body: { active: !placement.active },
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['platform', 'ad-placements'] }),
  });
  return (
    <>
      <PageHeader title={t('admin.ads.placements.title')} />
      <Banner tone="info">{t('admin.ads.placements.description')}</Banner>
      <FormError message={toggle.isError ? errorText(toggle.error) : null} />
      {query.isError ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          caption={t('admin.ads.placements.title')}
          loading={query.isPending}
          rows={query.data}
          rowKey={(row) => row.key}
          columns={[
            {
              key: 'surface',
              header: t('admin.ads.placements.surface'),
              render: (row) => (
                <div>
                  <strong>{row.surface}</strong>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    {row.key}
                  </div>
                </div>
              ),
            },
            {
              key: 'formats',
              header: t('admin.ads.placements.formats'),
              render: (row) =>
                row.formats
                  .map((f) => t(`admin.ads.creatives.type.${f as 'image_banner'}`))
                  .join(', '),
            },
            {
              key: 'size',
              header: t('admin.ads.placements.size'),
              render: (row) =>
                row.width && row.height ? `${row.width} × ${row.height}, ${row.maxFileKb} KB` : '-',
            },
            {
              key: 'cap',
              header: t('admin.ads.placements.cap'),
              align: 'right',
              render: (row) => row.frequencyCapPerDay,
            },
            {
              key: 'active',
              header: t('admin.ads.placements.active'),
              render: (row) => (
                <StatusPill
                  tone={row.active ? 'success' : 'neutral'}
                  label={row.active ? t('admin.ads.placements.on') : t('admin.ads.placements.off')}
                />
              ),
            },
            {
              key: 'actions',
              header: '',
              render: (row) =>
                can('ad.campaign.manage') ? (
                  <ActionButton
                    size="sm"
                    variant="outline"
                    busy={toggle.isPending && toggle.variables?.key === row.key}
                    onClick={() => toggle.mutate(row)}
                  >
                    {row.active
                      ? t('admin.ads.placements.turnOff')
                      : t('admin.ads.placements.turnOn')}
                  </ActionButton>
                ) : null,
            },
          ]}
        />
      )}
    </>
  );
}
