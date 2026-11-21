import { unwrapPage } from '@safezone/api-client';
import { colors, spacing, typography } from '@safezone/design-tokens';
import { type MessageKey, formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  Card,
  EmptyState,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
  StatusPill,
} from '@safezone/mobile-ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import { errorText } from '../../src/lib/errors';
import { useManager } from '../../src/lib/manager';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

/** Published announcements, newest first, with compose for publishers (management-mobile.md §7.6). */
export default function AnnouncementsScreen() {
  const router = useRouter();
  const { estateId, can } = useManager();
  const list = useInfiniteQuery({
    queryKey: ['estate', estateId, 'announcements', 'all'],
    queryFn: ({ pageParam }) =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/announcements', {
          params: { path: { estateId }, query: { all: 'true', limit: 20, cursor: pageParam } },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const pull = usePullRefresh(list.refetch);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const canPublish = can('announcement.publish');

  return (
    <ScrollScreen
      edges={['top', 'left', 'right', 'bottom']}
      {...pull}
      footer={
        canPublish ? (
          <ActionButton
            label={t('announcement.compose.title')}
            icon={<Icon name="create-outline" color={colors.brand.onPrimary} size={20} />}
            onPress={() => router.push('/announcements/new')}
          />
        ) : undefined
      }
    >
      <ScreenHeader
        title={t('announcement.title')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      {list.isPending ? (
        <>
          <Skeleton height={96} />
          <Skeleton height={96} />
        </>
      ) : null}
      {list.isError ? (
        <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
      ) : null}
      {list.data && items.length === 0 ? (
        <EmptyState
          icon={<Icon name="megaphone-outline" size={28} color={colors.brand.primary} />}
          title={t('announcement.empty.title')}
          body={canPublish ? t('announcement.empty.body') : undefined}
        />
      ) : null}
      {items.map((item) => (
        <Card key={item.id}>
          <View style={{ gap: spacing[1] }}>
            <View style={{ flexDirection: 'row', gap: spacing[2], flexWrap: 'wrap' }}>
              <StatusPill
                tone="neutral"
                label={t(`announcement.category.${item.category}` as MessageKey)}
              />
              {item.priority === 'important' ? (
                <StatusPill tone="warning" label={t('announcement.priority.important')} />
              ) : null}
            </View>
            <Text
              style={{
                fontSize: typography.size.md,
                fontWeight: typography.weight.semibold,
                color: colors.semantic.text,
              }}
            >
              {item.title}
            </Text>
            <Text
              numberOfLines={4}
              style={{ fontSize: typography.size.sm, color: colors.semantic.text }}
            >
              {item.body}
            </Text>
            <Text style={{ fontSize: typography.size.xs, color: colors.semantic.textMuted }}>
              {[
                formatDateTime(item.publishedAt),
                t(`announcement.audience.${item.audienceType}` as MessageKey),
                item.recipients !== null && item.recipients !== undefined
                  ? t('mm.announcements.recipients', { count: item.recipients })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </Card>
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
