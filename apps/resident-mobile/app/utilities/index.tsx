import { unwrap } from '@safezone/api-client';
import { colors, spacing, typography } from '@safezone/design-tokens';
import { formatDateTime, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Card,
  ConfirmModal,
  EmptyState,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  SectionHeader,
  Skeleton,
  StatusPill,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import {
  type Meter,
  OUTAGE_TONE,
  partitionOutages,
  utilityIcon,
} from '../../src/features/utilities';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

/** Utilities (resident-mobile.md §6.6): saved DisCo meters, estate sub-meters, and outage updates. */
export default function UtilitiesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { estateId, household, hasFeature } = useResident();
  const [showResolved, setShowResolved] = useState(false);
  const [removing, setRemoving] = useState<Meter | null>(null);

  const meters = useQuery({
    queryKey: ['estate', estateId, 'meters'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/meters', { params: { path: { estateId } } })),
    enabled: hasFeature('billing'),
  });
  const outages = useQuery({
    queryKey: ['estate', estateId, 'utility-outages'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/utility-outages', { params: { path: { estateId } } })),
    enabled: hasFeature('announcements'),
  });
  const remove = useMutation({
    mutationFn: (meter: Meter) =>
      unwrap(
        api.DELETE('/v1/estates/{estateId}/meters/{id}', {
          params: { path: { estateId, id: meter.id } },
        }),
      ),
    onSuccess: () => {
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'meters'] });
    },
  });

  const pull = usePullRefresh(() => Promise.all([meters.refetch(), outages.refetch()]));
  const { active: activeOutages, past: pastOutages } = partitionOutages(outages.data ?? []);
  const shownOutages = showResolved ? [...activeOutages, ...pastOutages] : activeOutages;

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={t('res.utilities.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/pay'))}
        backIcon={<Icon name="arrow-back" />}
      />

      {hasFeature('announcements') ? (
        <>
          <SectionHeader title={t('res.utilities.outages')} />
          {outages.isPending ? <Skeleton height={88} /> : null}
          {outages.isError ? (
            <ErrorState message={errorText(outages.error)} onRetry={() => void outages.refetch()} />
          ) : null}
          {outages.data && shownOutages.length === 0 ? (
            <Card>
              <Text style={styles.muted}>{t('res.utilities.noOutages')}</Text>
            </Card>
          ) : null}
          {shownOutages.map((item) => (
            <Card key={item.id}>
              <View style={styles.rowBetween}>
                <View style={styles.rowIconTitle}>
                  <Icon name={utilityIcon(item.type)} size={18} color={colors.brand.primary} />
                  <Text style={styles.cardTitle}>{item.title}</Text>
                </View>
                <StatusPill
                  tone={OUTAGE_TONE[item.status]}
                  label={t(`res.utilities.outage.${item.status}` as MessageKey)}
                />
              </View>
              <Text style={styles.meta}>
                {t(`res.utilities.type.${item.type}` as MessageKey)} ·{' '}
                {t('res.utilities.outageWindow', { start: formatDateTime(item.startsAt) })}
              </Text>
              {item.expectedEndAt ? (
                <Text style={styles.meta}>
                  {t('res.utilities.outageExpectedEnd', {
                    end: formatDateTime(item.expectedEndAt),
                  })}
                </Text>
              ) : null}
              {item.details ? <Text style={styles.body}>{item.details}</Text> : null}
            </Card>
          ))}
          {pastOutages.length > 0 ? (
            <ActionButton
              label={
                showResolved
                  ? t('res.utilities.hideResolved')
                  : t('res.utilities.showResolved', { count: pastOutages.length })
              }
              variant="text"
              onPress={() => setShowResolved((prev) => !prev)}
            />
          ) : null}
        </>
      ) : null}

      <SectionHeader title={t('res.utilities.meters')} />
      {meters.isPending ? <Skeleton height={120} /> : null}
      {meters.isError ? (
        <ErrorState message={errorText(meters.error)} onRetry={() => void meters.refetch()} />
      ) : null}
      {meters.data && meters.data.length === 0 ? (
        <EmptyState
          icon={<Icon name="flash-outline" size={28} color={colors.brand.primary} />}
          title={t('res.utilities.metersEmpty')}
          body={t('res.utilities.metersEmptyBody')}
        />
      ) : null}

      {(meters.data ?? []).map((meter) => (
        <Card key={meter.id}>
          <View style={styles.rowBetween}>
            <View style={styles.rowIconTitle}>
              <Icon name={utilityIcon(meter.type)} size={20} color={colors.brand.primary} />
              <Text selectable style={styles.meterNumber}>
                {meter.meterNumber}
              </Text>
            </View>
            <StatusPill
              tone={meter.supply === 'estate' ? 'info' : 'neutral'}
              label={
                meter.supply === 'estate'
                  ? t('res.utilities.estateSupply')
                  : meter.prepaid
                    ? t('res.utilities.prepaid')
                    : t('res.utilities.postpaid')
              }
            />
          </View>
          <Text style={styles.meta}>
            {meter.providerCode} · {meter.unitCode}
            {meter.accountName ? ` · ${meter.accountName}` : ''}
          </Text>
          {meter.lastReading !== null && meter.lastReadAt ? (
            <Text style={styles.body}>
              {t('res.utilities.lastReading', {
                reading: meter.lastReading,
                date: formatDateTime(meter.lastReadAt),
              })}
            </Text>
          ) : null}
          {meter.supply === 'public' ? (
            <ActionButton
              label={t('res.utilities.removeMeter')}
              variant="text"
              onPress={() => setRemoving(meter)}
            />
          ) : null}
        </Card>
      ))}

      {household ? (
        <ActionButton
          label={t('res.utilities.addMeter')}
          icon={<Icon name="add" color="#FFFFFF" size={20} />}
          onPress={() => router.push('/utilities/add-meter')}
        />
      ) : (
        <Text style={styles.muted}>{t('res.utilities.noUnit')}</Text>
      )}

      <ConfirmModal
        visible={Boolean(removing)}
        title={t('res.utilities.removeTitle')}
        body={removing ? t('res.utilities.removeBody', { number: removing.meterNumber }) : ''}
        confirmLabel={t('res.utilities.removeMeter')}
        cancelLabel={t('res.utilities.keep')}
        destructive
        busy={remove.isPending}
        error={remove.isError ? errorText(remove.error) : null}
        onConfirm={() => removing && remove.mutate(removing)}
        onCancel={() => setRemoving(null)}
      />
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing[2],
  },
  rowIconTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flex: 1,
  },
  cardTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    color: colors.semantic.text,
    flexShrink: 1,
  },
  meterNumber: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
    fontVariant: ['tabular-nums'],
  },
  meta: {
    fontSize: typography.size.xs,
    color: colors.semantic.textMuted,
  },
  body: {
    fontSize: typography.size.sm,
    color: colors.semantic.text,
  },
  muted: {
    fontSize: typography.size.sm,
    color: colors.semantic.textMuted,
  },
});
