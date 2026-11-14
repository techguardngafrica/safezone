import { unwrapPage } from '@safezone/api-client';
import { colors } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  EmptyState,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
} from '@safezone/mobile-ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Icon } from '../../src/components/icon';
import { AnnouncementCard } from '../../src/features/announcement-card';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

export default function AnnouncementsScreen() {
  const router = useRouter();
  const { estateId } = useResident();
  const list = useInfiniteQuery({
    queryKey: ['estate', estateId, 'announcements', 'resident'],
    queryFn: ({ pageParam }) =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/announcements', {
          params: { path: { estateId }, query: { limit: 20, cursor: pageParam } },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const pull = usePullRefresh(list.refetch);
  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={t('res.notice.title')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      {list.isPending ? <Skeleton height={96} /> : null}
      {list.isError ? (
        <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
      ) : null}
      {list.data && items.length === 0 ? (
        <EmptyState
          icon={<Icon name="megaphone-outline" size={28} color={colors.brand.primary} />}
          title={t('res.notice.empty')}
        />
      ) : null}
      {items.map((item) => (
        <AnnouncementCard
          key={item.id}
          item={item}
          onPress={() => router.push(`/announcements/${item.id}`)}
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
