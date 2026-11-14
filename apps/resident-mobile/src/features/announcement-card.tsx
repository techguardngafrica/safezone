import type { ApiRow } from '@safezone/api-client';
import { colors } from '@safezone/design-tokens';
import { formatDateTime, type MessageKey, t } from '@safezone/i18n';
import { Card, StatusPill } from '@safezone/mobile-ui';
import { Text, View } from 'react-native';

export type Announcement = ApiRow<'/v1/estates/{estateId}/announcements', 'get'>;

/** Notice card: official estate posts, with an unread dot. */
export function AnnouncementCard({ item, onPress }: { item: Announcement; onPress: () => void }) {
  const unread = item.read === false;
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${item.title}${unread ? `, ${t('res.notice.unread')}` : ''}`}
    >
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {unread ? (
          <View
            style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand.primary }}
          />
        ) : null}
        <Text style={{ color: colors.semantic.textMuted, fontSize: 13 }}>
          {t(`announcement.category.${item.category}` as MessageKey)} ·{' '}
          {formatDateTime(item.publishedAt)}
        </Text>
        {item.priority === 'important' ? (
          <StatusPill tone="warning" label={t('announcement.priority.important')} />
        ) : null}
      </View>
      <Text
        style={{ fontSize: 16, fontWeight: unread ? '700' : '600', color: colors.semantic.text }}
      >
        {item.title}
      </Text>
      <Text numberOfLines={2} style={{ color: colors.semantic.text, fontSize: 14 }}>
        {item.body}
      </Text>
    </Card>
  );
}
