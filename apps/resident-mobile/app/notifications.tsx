import { type ApiRow, unwrap, unwrapPage } from '@safezone/api-client';
import { colors, typography } from '@safezone/design-tokens';
import { formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  Card,
  EmptyState,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
} from '@safezone/mobile-ui';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { Icon } from '../src/components/icon';
import { errorText } from '../src/lib/errors';
import { api } from '../src/lib/session';
import { usePullRefresh } from '../src/lib/use-pull-refresh';

type Notification = ApiRow<'/v1/me/notifications', 'get'>;

/** Where a notification leads in the app, from the ids it carries. */
function target(item: Notification): string | null {
  const data = item.data as Record<string, unknown>;
  if (typeof data.walkinId === 'string') return `/walkin/${data.walkinId}`;
  if (typeof data.passId === 'string') return `/pass/${data.passId}`;
  if (typeof data.bookingId === 'string') return `/bookings/${data.bookingId}`;
  if (typeof data.requestId === 'string' && item.intent.startsWith('maintenance'))
    return `/issues/${data.requestId}`;
  if (typeof data.announcementId === 'string') return `/announcements/${data.announcementId}`;
  if (typeof data.alertId === 'string' && item.intent.startsWith('emergency'))
    return `/sos?id=${data.alertId}`;
  return null;
}

/** Notifications centre (UI_GUIDELINES §7.4): newest first, unread marked, tap to open. */
export default function NotificationsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const list = useInfiniteQuery({
    queryKey: ['me', 'notifications'],
    queryFn: ({ pageParam }) =>
      unwrapPage(
        api.GET('/v1/me/notifications', { params: { query: { limit: 30, cursor: pageParam } } }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const pull = usePullRefresh(list.refetch);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['me', 'notifications'] });

  const read = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST('/v1/me/notifications/{id}/read', { params: { path: { id } } })),
    onSuccess: refresh,
  });
  const readAll = useMutation({
    mutationFn: () => unwrap(api.POST('/v1/me/notifications/read-all')),
    onSuccess: refresh,
  });

  const open = (item: Notification) => {
    if (!item.readAt) read.mutate(item.id);
    const href = target(item);
    if (href) router.push(href as never);
  };

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={t('res.notifications.title')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
        trailing={
          items.some((item) => !item.readAt) ? (
            <ActionButton
              label={t('res.notifications.readAll')}
              variant="text"
              busy={readAll.isPending}
              onPress={() => readAll.mutate()}
            />
          ) : undefined
        }
      />
      {list.isPending ? <Skeleton height={80} /> : null}
      {list.isError ? (
        <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
      ) : null}
      {list.data && items.length === 0 ? (
        <EmptyState
          icon={<Icon name="notifications-outline" size={28} color={colors.brand.primary} />}
          title={t('res.notifications.empty')}
          body={t('res.notifications.emptyBody')}
        />
      ) : null}
      {items.map((item) => (
        <Card
          key={item.id}
          onPress={() => open(item)}
          accessibilityLabel={`${item.title}${item.readAt ? '' : `, ${t('res.notice.unread')}`}`}
        >
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            {!item.readAt ? (
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: colors.brand.primary,
                }}
              />
            ) : null}
            <Text
              style={{
                flex: 1,
                fontSize: typography.size.md,
                fontWeight: item.readAt ? '500' : '700',
                color: colors.semantic.text,
              }}
            >
              {item.title}
            </Text>
          </View>
          <Text style={{ fontSize: typography.size.sm, color: colors.semantic.text }}>
            {item.body}
          </Text>
          <Text style={{ fontSize: typography.size.xs, color: colors.semantic.textMuted }}>
            {formatDateTime(item.createdAt)}
          </Text>
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
