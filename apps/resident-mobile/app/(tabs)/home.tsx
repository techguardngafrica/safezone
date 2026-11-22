import { unwrapPage } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  Card,
  ScrollScreen,
  SectionHeader,
  Skeleton,
  useSession,
} from '@safezone/mobile-ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { EstateSwitcherModal } from '../../src/components/estate-switcher';
import { Icon, type IconName } from '../../src/components/icon';
import { SOS_CLEARANCE } from '../../src/components/sos-button';
import { AnnouncementCard } from '../../src/features/announcement-card';
import { PassCard } from '../../src/features/pass-card';
import { SponsoredSlot } from '../../src/features/sponsored-slot';
import { isUpcoming } from '../../src/features/passes';
import { errorText } from '../../src/lib/errors';
import { useUnreadNotifications } from '../../src/lib/notifications';
import { useResident } from '../../src/lib/resident';
import { api, session } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

function Tile({
  label,
  icon,
  tone,
  onPress,
}: {
  label: string;
  icon: IconName;
  tone: 'forest' | 'sand';
  onPress: () => void;
}) {
  const palette = colors.tile[tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: palette.background },
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={[styles.tileChip, { backgroundColor: palette.chip }]}>
        <Icon name={icon} color="#FFFFFF" />
      </View>
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  );
}

/** Home (UI_GUIDELINES §8.1): greeting, shortcuts, upcoming visitors, latest notices. */
export default function HomeScreen() {
  const router = useRouter();
  const user = useSession(session).user;
  const { estateId, estateName, memberships, household, can, hasFeature } = useResident();
  const [switchingEstate, setSwitchingEstate] = useState(false);
  const firstName = user?.fullName?.split(' ')[0] ?? '';

  const passes = useQuery({
    queryKey: ['estate', estateId, 'visitor-passes', 'mine', 'home'],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/visitor-passes', {
          params: { path: { estateId }, query: { mine: 'true', limit: 20 } },
        }),
      ),
    enabled: hasFeature('visitors'),
  });
  const notices = useQuery({
    queryKey: ['estate', estateId, 'announcements', 'home'],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/announcements', {
          params: { path: { estateId }, query: { limit: 3 } },
        }),
      ),
    enabled: hasFeature('announcements'),
  });
  const upcoming = (passes.data?.items ?? []).filter(isUpcoming).slice(0, 3);
  const unread = useUnreadNotifications();

  const pull = usePullRefresh(() => Promise.all([passes.refetch(), notices.refetch()]));
  return (
    <ScrollScreen bottomInset={SOS_CLEARANCE} {...pull}>
      <View style={{ gap: spacing[1] }}>
        <View style={styles.headerRow}>
          <Text style={[styles.greeting, { flex: 1 }]}>
            {firstName ? t('res.home.hello', { name: firstName }) : t('res.home.helloNoName')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              unread > 0
                ? t('res.notifications.bellUnread', { count: unread })
                : t('res.notifications.title')
            }
            onPress={() => router.push('/notifications')}
            style={styles.bell}
          >
            <Icon name="notifications-outline" color={colors.semantic.text} />
            {unread > 0 ? (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
        <Text accessibilityRole="header" style={styles.title}>
          {t('res.home.welcome')}
        </Text>
        {memberships.length > 1 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('res.estates.switchLabel', { estate: estateName })}
            onPress={() => setSwitchingEstate(true)}
            style={({ pressed }) => [
              styles.place,
              styles.placePressable,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Icon name="location-outline" size={16} color={colors.brand.primary} />
            <Text style={styles.placeText}>
              {household ? `${household.unit.code}, ${estateName}` : estateName}
            </Text>
            <Icon name="chevron-down" size={16} color={colors.brand.primary} />
          </Pressable>
        ) : (
          <View style={styles.place}>
            <Icon name="location-outline" size={16} color={colors.semantic.textMuted} />
            <Text style={styles.placeText}>
              {household ? `${household.unit.code}, ${estateName}` : estateName}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.tiles}>
        {hasFeature('visitors') && can('visitor.invite') ? (
          <Tile
            label={t('res.home.inviteVisitor')}
            icon="person-add-outline"
            tone="forest"
            onPress={() => router.push('/pass/new')}
          />
        ) : null}
        {hasFeature('maintenance') && can('maintenance.request') ? (
          <Tile
            label={t('res.home.reportIssue')}
            icon="construct-outline"
            tone="sand"
            onPress={() => router.push('/issues/new')}
          />
        ) : null}
        {hasFeature('facilities') && can('facility.book') ? (
          <Tile
            label={t('res.home.bookFacility')}
            icon="calendar-outline"
            tone="forest"
            onPress={() => router.push('/facilities')}
          />
        ) : null}
        {hasFeature('announcements') ? (
          <Tile
            label={t('res.home.notices')}
            icon="megaphone-outline"
            tone="sand"
            onPress={() => router.push('/announcements')}
          />
        ) : null}
      </View>

      <SponsoredSlot placement="resident.home.banner" context="home" />

      {hasFeature('visitors') ? (
        <>
          <SectionHeader
            title={t('res.home.upcomingVisitors')}
            action={
              <ActionButton
                label={t('res.home.seeAll')}
                variant="text"
                onPress={() => router.push('/visitors')}
              />
            }
          />
          {passes.isPending ? <Skeleton height={88} /> : null}
          {passes.isError ? (
            <Text style={{ color: colors.status.danger }}>{errorText(passes.error)}</Text>
          ) : null}
          {passes.data && upcoming.length === 0 ? (
            <Card>
              <Text style={{ color: colors.semantic.textMuted }}>{t('res.home.noVisitors')}</Text>
            </Card>
          ) : null}
          {upcoming.map((pass) => (
            <PassCard key={pass.id} pass={pass} onPress={() => router.push(`/pass/${pass.id}`)} />
          ))}
        </>
      ) : null}

      {hasFeature('announcements') ? (
        <>
          <SectionHeader
            title={t('res.home.latestNotices')}
            action={
              <ActionButton
                label={t('res.home.seeAll')}
                variant="text"
                onPress={() => router.push('/announcements')}
              />
            }
          />
          {notices.isPending ? <Skeleton height={88} /> : null}
          {notices.isError ? (
            <Text style={{ color: colors.status.danger }}>{errorText(notices.error)}</Text>
          ) : null}
          {notices.data?.items.length === 0 ? (
            <Card>
              <Text style={{ color: colors.semantic.textMuted }}>{t('res.home.noNotices')}</Text>
            </Card>
          ) : null}
          {notices.data?.items.map((item) => (
            <AnnouncementCard
              key={item.id}
              item={item}
              onPress={() => router.push(`/announcements/${item.id}`)}
            />
          ))}
        </>
      ) : null}
      <EstateSwitcherModal
        visible={switchingEstate}
        onClose={() => setSwitchingEstate(false)}
        onJoinAnother={() => router.push('/join')}
      />
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  greeting: { fontSize: typography.size.sm, color: colors.semantic.textMuted },
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  place: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  placePressable: { alignSelf: 'flex-start', paddingVertical: spacing[1] },
  placeText: { fontSize: typography.size.sm, color: colors.semantic.text },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  bell: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.semantic.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: typography.weight.bold },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    borderRadius: radii.lg,
    padding: spacing[4],
    gap: spacing[3],
    minHeight: 112,
  },
  tileChip: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    color: colors.semantic.text,
  },
});
