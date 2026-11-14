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
import { SOS_CLEARANCE } from '../../src/components/sos-button';
import { PassCard } from '../../src/features/pass-card';
import { isUpcoming } from '../../src/features/passes';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

export default function VisitorsScreen() {
  const router = useRouter();
  const { estateId, can } = useResident();
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming');
  const passes = useInfiniteQuery({
    queryKey: ['estate', estateId, 'visitor-passes', 'mine'],
    queryFn: ({ pageParam }) =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/visitor-passes', {
          params: { path: { estateId }, query: { mine: 'true', limit: 50, cursor: pageParam } },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const all = passes.data?.pages.flatMap((page) => page.items) ?? [];
  const shown = all.filter((pass) => (view === 'upcoming' ? isUpcoming(pass) : !isUpcoming(pass)));
  const canInvite = can('visitor.invite');

  const pull = usePullRefresh(passes.refetch);
  return (
    <ScrollScreen {...pull} bottomInset={SOS_CLEARANCE}>
      <ScreenHeader title={t('res.visitors.title')} subtitle={t('res.visitors.subtitle')} />
      {canInvite ? (
        <ActionButton
          label={t('res.visitors.invite')}
          icon={<Icon name="person-add-outline" color="#FFFFFF" size={20} />}
          onPress={() => router.push('/pass/new')}
        />
      ) : null}
      <Segmented
        label={t('res.visitors.title')}
        value={view}
        onChange={setView}
        options={[
          { key: 'upcoming', label: t('res.visitors.upcoming') },
          { key: 'past', label: t('res.visitors.past') },
        ]}
      />
      {passes.isPending ? (
        <>
          <Skeleton height={96} />
          <Skeleton height={96} />
        </>
      ) : passes.isError ? (
        <ErrorState message={errorText(passes.error)} onRetry={() => void passes.refetch()} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<Icon name="people-outline" size={28} color={colors.brand.primary} />}
          title={
            view === 'upcoming' ? t('res.visitors.emptyUpcoming') : t('res.visitors.emptyPast')
          }
          body={view === 'upcoming' && canInvite ? t('res.visitors.emptyBody') : undefined}
        />
      ) : (
        shown.map((pass) => (
          <PassCard key={pass.id} pass={pass} onPress={() => router.push(`/pass/${pass.id}`)} />
        ))
      )}
      {passes.hasNextPage ? (
        <ActionButton
          label={t('ui.loadMore')}
          variant="outline"
          busy={passes.isFetchingNextPage}
          onPress={() => void passes.fetchNextPage()}
        />
      ) : null}
    </ScrollScreen>
  );
}
