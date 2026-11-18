import { unwrap } from '@safezone/api-client';
import { colors, typography } from '@safezone/design-tokens';
import { formatTime, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
  StatusPill,
  type Tone,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Icon } from '../../src/components/icon';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';

const TONE: Record<string, Tone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  timed_out: 'neutral',
  cancelled: 'neutral',
};

/**
 * Walk-in approval (UI_GUIDELINES §8.1): a guard asks whether to let a visitor without a pass in.
 * Shows who, which unit and the time left; Approve or Reject. No ads on this screen.
 */
export default function WalkInScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId } = useResident();
  const [now, setNow] = useState(() => Date.now());

  const walkin = useQuery({
    queryKey: ['estate', estateId, 'walkin', id],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/walkins/{id}', { params: { path: { estateId, id } } }),
      ),
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 5_000 : false),
  });
  const pending = walkin.data?.status === 'pending';
  useEffect(() => {
    if (!pending) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [pending]);

  const decide = useMutation({
    mutationFn: (approve: boolean) =>
      approve
        ? unwrap(
            api.POST('/v1/estates/{estateId}/walkins/{id}/approve', {
              params: { path: { estateId, id } },
            }),
          )
        : unwrap(
            api.POST('/v1/estates/{estateId}/walkins/{id}/reject', {
              params: { path: { estateId, id } },
            }),
          ),
    onSuccess: (data) => queryClient.setQueryData(['estate', estateId, 'walkin', id], data),
  });

  const data = walkin.data;
  const secondsLeft = data
    ? Math.max(0, Math.floor((new Date(data.expiresAt).getTime() - now) / 1000))
    : 0;
  const expired = pending && secondsLeft === 0;

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        title={t('res.walkin.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/home'))}
        backIcon={<Icon name="arrow-back" />}
      />
      {walkin.isPending ? <Skeleton height={200} /> : null}
      {walkin.isError ? (
        <ErrorState message={errorText(walkin.error)} onRetry={() => void walkin.refetch()} />
      ) : null}
      {data ? (
        <>
          <Card>
            <Text
              style={{
                fontSize: typography.size.xl,
                fontWeight: '700',
                color: colors.semantic.text,
              }}
            >
              {data.visitorName}
            </Text>
            {data.purpose ? (
              <Text style={{ fontSize: typography.size.md, color: colors.semantic.text }}>
                {data.purpose}
              </Text>
            ) : null}
            <Text style={{ color: colors.semantic.textMuted }}>
              {t('res.walkin.forUnit', { unit: data.unitCode ?? '-' })}
              {data.vehiclePlate ? ` · ${data.vehiclePlate}` : ''} · {formatTime(data.createdAt)}
            </Text>
            <StatusPill
              tone={TONE[data.status] ?? 'neutral'}
              label={t(`res.walkin.status.${data.status}` as MessageKey)}
            />
          </Card>
          {pending && !expired ? (
            <>
              <Text
                accessibilityLiveRegion="polite"
                style={{
                  fontSize: typography.size.lg,
                  fontWeight: '700',
                  color: colors.status.warning,
                  textAlign: 'center',
                }}
              >
                {t('res.walkin.timeLeft', {
                  minutes: Math.floor(secondsLeft / 60),
                  seconds: String(secondsLeft % 60).padStart(2, '0'),
                })}
              </Text>
              <ActionButton
                label={t('res.walkin.approve')}
                large
                busy={decide.isPending && decide.variables === true}
                onPress={() => decide.mutate(true)}
              />
              <ActionButton
                label={t('res.walkin.reject')}
                variant="outline"
                large
                busy={decide.isPending && decide.variables === false}
                onPress={() => decide.mutate(false)}
              />
            </>
          ) : null}
          {expired ? <Banner tone="info">{t('res.walkin.expired')}</Banner> : null}
          {decide.isError ? <Banner tone="danger">{errorText(decide.error)}</Banner> : null}
        </>
      ) : null}
    </ScrollScreen>
  );
}
