import { unwrapPage } from '@safezone/api-client';
import { colors } from '@safezone/design-tokens';
import { type MessageKey, formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  EmptyState,
  ErrorState,
  ListRow,
  ScreenHeader,
  ScrollScreen,
  Segmented,
  Skeleton,
  StatusPill,
} from '@safezone/mobile-ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Icon } from '../../src/components/icon';
import { SEVERITY_TONE } from '../../src/features/incident-rules';
import { errorText, isNetworkError } from '../../src/lib/errors';
import { useManager } from '../../src/lib/manager';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

/** Incident review list (management-mobile.md §4 "Security staff"): open first, then all. */
export default function IncidentsScreen() {
  const router = useRouter();
  const { estateId } = useManager();
  const [view, setView] = useState<'open' | 'all'>('open');
  const list = useInfiniteQuery({
    queryKey: ['estate', estateId, 'incidents', view],
    queryFn: ({ pageParam }) =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/incidents', {
          params: {
            path: { estateId },
            query: { open: view === 'open' ? 'true' : undefined, limit: 30, cursor: pageParam },
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 60_000,
  });
  const pull = usePullRefresh(list.refetch);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={t('mm.incidents.title')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      <Segmented
        label={t('mm.incidents.title')}
        value={view}
        onChange={setView}
        options={[
          { key: 'open', label: t('mm.incidents.open') },
          { key: 'all', label: t('mm.incidents.all') },
        ]}
      />
      {list.isPending ? (
        <>
          <Skeleton height={64} />
          <Skeleton height={64} />
        </>
      ) : null}
      {list.isError ? (
        isNetworkError(list.error) ? (
          <Banner tone="warning">{t('mm.offline.cached')}</Banner>
        ) : (
          <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
        )
      ) : null}
      {list.data && items.length === 0 ? (
        <EmptyState
          icon={<Icon name="document-text-outline" size={28} color={colors.brand.primary} />}
          title={view === 'open' ? t('mm.incidents.emptyOpen') : t('incident.empty.title')}
          body={t('incident.empty.body')}
        />
      ) : null}
      {items.map((incident) => (
        <ListRow
          key={incident.id}
          title={incident.title}
          subtitle={[
            t(`incident.category.${incident.category}` as MessageKey),
            t(`incident.status.${incident.status}` as MessageKey),
            incident.gateName ?? incident.unitCode ?? incident.locationText,
            formatDateTime(incident.occurredAt),
          ]
            .filter(Boolean)
            .join(' · ')}
          trailing={
            <StatusPill
              tone={SEVERITY_TONE[incident.severity]}
              label={t(`incident.severity.${incident.severity}` as MessageKey)}
            />
          }
          onPress={() => router.push(`/incidents/${incident.id}`)}
        />
      ))}
      {list.hasNextPage ? (
        <ActionButton
          label={t('ui.loadMore')}
          variant="outline"
          busy={list.isFetchingNextPage}
          onPress={() => void list.fetchNextPage()}
        />
      ) : null}
    </ScrollScreen>
  );
}
