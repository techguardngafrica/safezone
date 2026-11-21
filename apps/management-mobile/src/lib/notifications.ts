import { unwrapPage } from '@safezone/api-client';
import { useQuery } from '@tanstack/react-query';
import { api } from './session';

/** Unread count for the bell: counts unread items on the newest page (shown as "9+" above 9). */
export function useUnreadNotifications() {
  const query = useQuery({
    queryKey: ['me', 'notifications', 'unread-count'],
    queryFn: () =>
      unwrapPage(api.GET('/v1/me/notifications', { params: { query: { limit: 20 } } })),
    refetchInterval: 60_000,
  });
  return query.data?.items.filter((item) => !item.readAt).length ?? 0;
}
