import { unwrap } from '@safezone/api-client';
import { colors, typography } from '@safezone/design-tokens';
import { formatDateTime, type MessageKey, t } from '@safezone/i18n';
import { ScreenHeader, ScrollScreen } from '@safezone/mobile-ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { Icon } from '../../src/components/icon';
import type { Announcement } from '../../src/features/announcement-card';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';

/** Finds the notice in any cached list, so opening it needs no extra request. */
function findCached(queryClient: ReturnType<typeof useQueryClient>, estateId: string, id: string) {
  for (const [, data] of queryClient.getQueriesData<unknown>({
    queryKey: ['estate', estateId, 'announcements'],
  })) {
    const pages = (data as { pages?: unknown[] } | undefined)?.pages ?? (data ? [data] : []);
    for (const page of pages) {
      const found = (page as { items?: Announcement[] }).items?.find((item) => item.id === id);
      if (found) return found;
    }
  }
  return undefined;
}

export default function AnnouncementScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId } = useResident();
  const item = findCached(queryClient, estateId, id);

  useEffect(() => {
    if (item?.read !== false) return;
    void unwrap(
      api.POST('/v1/estates/{estateId}/announcements/{id}/read', {
        params: { path: { estateId, id } },
      }),
    )
      .then(() =>
        queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'announcements'] }),
      )
      .catch(() => undefined);
  }, [estateId, id, item?.read, queryClient]);

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        title={item?.title ?? t('res.notice.title')}
        subtitle={
          item
            ? `${t(`announcement.category.${item.category}` as MessageKey)} · ${formatDateTime(item.publishedAt)}`
            : undefined
        }
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      <Text style={{ fontSize: typography.size.md, color: colors.semantic.text, lineHeight: 24 }}>
        {item?.body ?? t('res.notice.missing')}
      </Text>
    </ScrollScreen>
  );
}
