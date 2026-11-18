import { unwrapPage } from '@safezone/api-client';
import { colors } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  EmptyState,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Segmented,
  Skeleton,
} from '@safezone/mobile-ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Icon } from '../../src/components/icon';
import { IssueCard } from '../../src/features/issue-card';
import { type Issue, isOpen } from '../../src/features/issues';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

/** The resident's maintenance requests and complaints. */
export default function IssuesScreen() {
  const router = useRouter();
  const { estateId, can } = useResident();
  const [view, setView] = useState<'open' | 'closed'>('open');
  const list = useInfiniteQuery({
    queryKey: ['estate', estateId, 'maintenance-requests', 'mine'],
    queryFn: ({ pageParam }) =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/maintenance-requests', {
          params: { path: { estateId }, query: { mine: 'true', limit: 50, cursor: pageParam } },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const pull = usePullRefresh(list.refetch);
  const all: Issue[] = list.data?.pages.flatMap((page) => page.items) ?? [];
  const shown = all.filter((issue) => (view === 'open' ? isOpen(issue) : !isOpen(issue)));

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={t('res.issue.title')}
        subtitle={t('res.issue.subtitle')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      {can('maintenance.request') ? (
        <ActionButton
          label={t('res.issue.report')}
          icon={<Icon name="construct-outline" color="#FFFFFF" size={20} />}
          onPress={() => router.push('/issues/new')}
        />
      ) : null}
      <Segmented
        label={t('res.issue.title')}
        value={view}
        onChange={setView}
        options={[
          { key: 'open', label: t('res.issue.open') },
          { key: 'closed', label: t('res.issue.closed') },
        ]}
      />
      {list.isPending ? <Skeleton height={88} /> : null}
      {list.isError ? (
        <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
      ) : null}
      {list.data && shown.length === 0 ? (
        <EmptyState
          icon={<Icon name="construct-outline" size={28} color={colors.brand.primary} />}
          title={view === 'open' ? t('res.issue.emptyOpen') : t('res.issue.emptyClosed')}
          body={view === 'open' ? t('res.issue.emptyBody') : undefined}
        />
      ) : null}
      {shown.map((issue) => (
        <IssueCard
          key={issue.id}
          issue={issue}
          onPress={() => router.push(`/issues/${issue.id}`)}
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
