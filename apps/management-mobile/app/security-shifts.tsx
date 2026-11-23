import { unwrap } from '@safezone/api-client';
import { colors, spacing, typography } from '@safezone/design-tokens';
import { formatDateTime, formatTime, t } from '@safezone/i18n';
import {
  Banner,
  Card,
  EmptyState,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
  StatusPill,
} from '@safezone/mobile-ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { Icon } from '../src/components/icon';
import { errorText, isNetworkError } from '../src/lib/errors';
import { useManager } from '../src/lib/manager';
import { api } from '../src/lib/session';
import { usePullRefresh } from '../src/lib/use-pull-refresh';

/** Guard shift attendance view (management-mobile.md §4 Security staff). */
export default function SecurityShiftsScreen() {
  const router = useRouter();
  const { estateId, can, hasFeature } = useManager();
  const allowed = hasFeature('security') && can('security.staff.manage');
  const shifts = useQuery({
    queryKey: ['estate', estateId, 'shift-sessions'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/shift-sessions', {
          params: { path: { estateId }, query: { limit: 50 } },
        }),
      ),
    enabled: allowed,
  });
  const guards = useQuery({
    queryKey: ['estate', estateId, 'guards'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/guards', { params: { path: { estateId } } })),
    enabled: allowed,
    staleTime: 5 * 60_000,
  });
  const pull = usePullRefresh(shifts.refetch);
  const guardName = (userId: string) =>
    guards.data?.find((g) => g.userId === userId)?.fullName ?? t('mm.approvals.unknownName');

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={t('mm.security.shiftsTitle')}
        subtitle={t('mm.security.shiftsSubtitle')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      {shifts.isPending ? (
        <>
          <Skeleton height={80} />
          <Skeleton height={80} />
        </>
      ) : null}
      {shifts.isError ? (
        isNetworkError(shifts.error) ? (
          <Banner tone="warning">{t('mm.offline.cached')}</Banner>
        ) : (
          <ErrorState message={errorText(shifts.error)} onRetry={() => void shifts.refetch()} />
        )
      ) : null}
      {shifts.data && shifts.data.length === 0 ? (
        <EmptyState
          icon={<Icon name="time-outline" size={28} color={colors.brand.primary} />}
          title={t('mm.security.shiftsEmpty')}
          body={t('mm.security.shiftsEmptyBody')}
        />
      ) : null}
      {(shifts.data ?? []).map((shift) => {
        const open = !shift.endedAt;
        return (
          <Card key={shift.id}>
            <View style={{ gap: spacing[1] }}>
              <View
                style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing[2] }}
              >
                <Text
                  style={{
                    flex: 1,
                    fontSize: typography.size.md,
                    fontWeight: typography.weight.semibold,
                    color: colors.semantic.text,
                  }}
                >
                  {guardName(shift.userId)}
                </Text>
                <StatusPill
                  tone={open ? 'success' : 'neutral'}
                  label={open ? t('mm.security.shiftActive') : t('mm.security.shiftEnded')}
                />
              </View>
              <Text style={{ fontSize: typography.size.sm, color: colors.semantic.textMuted }}>
                {[
                  shift.gateName,
                  shift.endedAt
                    ? t('mm.security.shiftWindow', {
                        start: formatDateTime(shift.startedAt),
                        end: formatTime(shift.endedAt),
                      })
                    : t('mm.security.shiftSince', { start: formatDateTime(shift.startedAt) }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {shift.handoverNote ? (
                <Text style={{ fontSize: typography.size.sm, color: colors.semantic.text }}>
                  {shift.handoverNote}
                </Text>
              ) : null}
            </View>
          </Card>
        );
      })}
    </ScrollScreen>
  );
}
