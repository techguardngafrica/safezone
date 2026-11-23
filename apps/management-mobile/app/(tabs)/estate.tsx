import { unwrap, unwrapPage } from '@safezone/api-client';
import { maskPhone } from '@safezone/auth';
import { colors, spacing, touchTarget, typography } from '@safezone/design-tokens';
import { type MessageKey, formatDateTime, formatKobo, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ChipGroup,
  ConfirmModal,
  EmptyState,
  ErrorState,
  ListRow,
  ScreenHeader,
  ScrollScreen,
  SectionHeader,
  Segmented,
  Skeleton,
  StatusPill,
  TextField,
  type Tone,
} from '@safezone/mobile-ui';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import {
  MAINTENANCE_PRIORITY_TONE,
  MAINTENANCE_STATUS_TONE,
  isMaintenanceOpen,
} from '../../src/features/maintenance-rules';
import { monthToDateWat } from '../../src/lib/dates';
import { errorText, isNetworkError } from '../../src/lib/errors';
import { useManager } from '../../src/lib/manager';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

type EstateSection = 'people' | 'maintenance' | 'facilities' | 'finance';
type BookingAction = 'approve' | 'reject' | 'check_in' | 'no_show' | 'cancel';

const BOOKING_TONE: Record<string, Tone> = {
  pending_approval: 'warning',
  pending_payment: 'warning',
  confirmed: 'info',
  checked_in: 'success',
  completed: 'success',
  no_show: 'danger',
  cancelled: 'neutral',
  rejected: 'danger',
};

const TX_TONE: Record<string, Tone> = {
  succeeded: 'success',
  failed: 'danger',
  pending: 'warning',
  refunded: 'neutral',
};

function useDebounced(value: string, ms = 350): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function PeopleSection() {
  const router = useRouter();
  const { estateId, can, hasFeature } = useManager();
  const [sub, setSub] = useState<'residents' | 'units'>('residents');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const showPhone = can('pii.view');
  const canResidents = hasFeature('occupancy') && can('resident.read');

  const residents = useInfiniteQuery({
    queryKey: ['estate', estateId, 'residents', q],
    queryFn: ({ pageParam }) =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/residents', {
          params: {
            path: { estateId },
            query: { q: q || undefined, limit: 30, cursor: pageParam },
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: canResidents && sub === 'residents',
  });

  const units = useQuery({
    queryKey: ['estate', estateId, 'units', q],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/units', {
          params: { path: { estateId }, query: { q: q || undefined, limit: 50 } },
        }),
      ),
    enabled: sub === 'units',
  });

  const residentItems = residents.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <ChipGroup
        label={t('mm.estate.tab.people')}
        options={[
          ...(canResidents
            ? [{ key: 'residents' as const, label: t('mm.estate.sub.residents') }]
            : []),
          { key: 'units' as const, label: t('mm.estate.sub.units') },
        ]}
        value={sub}
        onChange={setSub}
      />
      <TextField
        label={sub === 'residents' ? t('resident.search') : t('mm.estate.unitsSearch')}
        placeholder={
          sub === 'residents'
            ? t('resident.searchPlaceholder')
            : t('mm.estate.unitsSearchPlaceholder')
        }
        value={search}
        onChangeText={setSearch}
        autoCapitalize="words"
      />
      {sub === 'residents' ? (
        <>
          {residents.isPending ? (
            <>
              <Skeleton height={64} />
              <Skeleton height={64} />
            </>
          ) : null}
          {residents.isError ? (
            isNetworkError(residents.error) ? (
              <Banner tone="warning">{t('mm.offline.cached')}</Banner>
            ) : (
              <ErrorState
                message={errorText(residents.error)}
                onRetry={() => void residents.refetch()}
              />
            )
          ) : null}
          {residents.data && residentItems.length === 0 ? (
            <EmptyState
              icon={<Icon name="people-outline" size={28} color={colors.brand.primary} />}
              title={q ? t('resident.empty.searchTitle') : t('resident.empty.title')}
              body={q ? undefined : t('resident.empty.body')}
            />
          ) : null}
          {residentItems.map((resident) => (
            <ListRow
              key={resident.memberId}
              title={resident.fullName}
              subtitle={[
                resident.unit.code,
                t(`resident.relationship.${resident.relationship}` as MessageKey),
                resident.phone
                  ? showPhone
                    ? resident.phone
                    : maskPhone(resident.phone)
                  : t('resident.noAccount'),
              ].join(' · ')}
              leading={<Icon name="person-outline" color={colors.brand.primary} size={20} />}
              onPress={() =>
                router.push({
                  pathname: '/residents/[id]',
                  params: {
                    id: resident.memberId,
                    name: resident.fullName,
                    unitCode: resident.unit.code,
                    unitId: resident.unit.id,
                    relationship: resident.relationship,
                    phone: resident.phone ?? '',
                    householdId: resident.householdId,
                  },
                })
              }
              trailing={
                showPhone && resident.phone ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('mm.estate.call', { name: resident.fullName })}
                    onPress={() => void Linking.openURL(`tel:${resident.phone}`)}
                    style={{
                      width: touchTarget.default,
                      height: touchTarget.default,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="call-outline" color={colors.brand.primary} size={22} />
                  </Pressable>
                ) : undefined
              }
            />
          ))}
          {residents.hasNextPage ? (
            <ActionButton
              label={t('ui.loadMore')}
              variant="outline"
              busy={residents.isFetchingNextPage}
              onPress={() => void residents.fetchNextPage()}
            />
          ) : null}
          {residentItems.length > 0 ? (
            <Banner tone="neutral">{t('mm.estate.webOnly')}</Banner>
          ) : null}
        </>
      ) : (
        <>
          {units.isPending ? (
            <>
              <Skeleton height={64} />
              <Skeleton height={64} />
            </>
          ) : null}
          {units.isError ? (
            <ErrorState message={errorText(units.error)} onRetry={() => void units.refetch()} />
          ) : null}
          {units.data && units.data.length === 0 ? (
            <EmptyState
              icon={<Icon name="home-outline" size={28} color={colors.brand.primary} />}
              title={t('mm.estate.unitsEmpty')}
              body={t('mm.estate.unitsEmptyBody')}
            />
          ) : null}
          {(units.data ?? []).map((unit) => (
            <ListRow
              key={unit.id}
              title={`${unit.code}${unit.name && unit.name !== unit.code ? ` · ${unit.name}` : ''}`}
              subtitle={[
                unit.unitType,
                unit.bedrooms ? t('mm.estate.unitBedrooms', { count: unit.bedrooms }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              leading={<Icon name="home-outline" color={colors.brand.primary} size={20} />}
              trailing={
                unit.status ? (
                  <StatusPill
                    tone={
                      unit.status === 'occupied'
                        ? 'success'
                        : unit.status === 'vacant'
                          ? 'info'
                          : 'neutral'
                    }
                    label={unit.status}
                  />
                ) : undefined
              }
            />
          ))}
        </>
      )}
    </>
  );
}

function MaintenanceSection() {
  const router = useRouter();
  const { estateId } = useManager();
  const [filter, setFilter] = useState<'open' | 'in_progress' | 'resolved' | 'all'>('open');
  const requests = useQuery({
    queryKey: ['estate', estateId, 'maintenance-requests'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/maintenance-requests', {
          params: { path: { estateId }, query: { limit: 50 } },
        }),
      ),
  });
  const items = (requests.data ?? []).filter((req) => {
    if (filter === 'all') return true;
    if (filter === 'open') return isMaintenanceOpen(req.status);
    if (filter === 'in_progress')
      return req.status === 'in_progress' || req.status === 'awaiting_materials';
    return req.status === 'resolved' || req.status === 'closed';
  });

  return (
    <>
      <ChipGroup
        label={t('mm.estate.tab.maintenance')}
        options={(['open', 'in_progress', 'resolved', 'all'] as const).map((key) => ({
          key,
          label: t(`mm.maintenance.filter.${key}` as MessageKey),
        }))}
        value={filter}
        onChange={setFilter}
      />
      {requests.isPending ? (
        <>
          <Skeleton height={96} />
          <Skeleton height={96} />
        </>
      ) : null}
      {requests.isError ? (
        isNetworkError(requests.error) ? (
          <Banner tone="warning">{t('mm.offline.cached')}</Banner>
        ) : (
          <ErrorState message={errorText(requests.error)} onRetry={() => void requests.refetch()} />
        )
      ) : null}
      {requests.data && items.length === 0 ? (
        <EmptyState
          icon={<Icon name="construct-outline" size={28} color={colors.brand.primary} />}
          title={t('mm.maintenance.empty')}
          body={t('mm.maintenance.emptyBody')}
        />
      ) : null}
      {items.map((req) => (
        <Card key={req.id}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/maintenance/${req.id}`)}
            style={{ gap: spacing[2] }}
          >
            <View style={{ flexDirection: 'row', gap: spacing[2], flexWrap: 'wrap' }}>
              <StatusPill
                tone={MAINTENANCE_STATUS_TONE[req.status]}
                label={t(`mm.maintenance.status.${req.status}` as MessageKey)}
              />
              <StatusPill
                tone={MAINTENANCE_PRIORITY_TONE[req.priority]}
                label={t(`mm.maintenance.priority.${req.priority}` as MessageKey)}
              />
              {req.slaBreached ? (
                <StatusPill tone="danger" label={t('mm.maintenance.slaBreached')} />
              ) : null}
            </View>
            <Text style={styles.cardTitle}>
              {req.number} · {req.title}
            </Text>
            <Text style={styles.muted}>
              {[req.unitCode, req.categoryName, formatDateTime(req.createdAt)]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </Pressable>
        </Card>
      ))}
    </>
  );
}

function FacilitiesSection() {
  const { estateId } = useManager();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'pending_approval' | 'confirmed' | 'all'>(
    'pending_approval',
  );
  const [pending, setPending] = useState<{
    id: string;
    name: string;
    action: BookingAction;
  } | null>(null);
  const [reason, setReason] = useState('');

  const bookings = useQuery({
    queryKey: ['estate', estateId, 'bookings', filter],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/bookings', {
          params: {
            path: { estateId },
            query: filter === 'all' ? {} : { status: filter },
          },
        }),
      ),
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: BookingAction }) => {
      const path = { estateId, id };
      switch (action) {
        case 'approve':
          return unwrap(
            api.POST('/v1/estates/{estateId}/bookings/{id}/approve', { params: { path } }),
          );
        case 'reject':
          return unwrap(
            api.POST('/v1/estates/{estateId}/bookings/{id}/reject', {
              params: { path },
              body: { reason: reason.trim() },
            }),
          );
        case 'check_in':
          return unwrap(
            api.POST('/v1/estates/{estateId}/bookings/{id}/check-in', { params: { path } }),
          );
        case 'no_show':
          return unwrap(
            api.POST('/v1/estates/{estateId}/bookings/{id}/no-show', { params: { path } }),
          );
        case 'cancel':
          return unwrap(
            api.POST('/v1/estates/{estateId}/bookings/{id}/cancel', {
              params: { path },
              body: { reason: reason.trim() },
            }),
          );
      }
    },
    onSuccess: () => {
      setPending(null);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'bookings'] });
    },
  });

  const needsReason = pending?.action === 'reject' || pending?.action === 'cancel';

  return (
    <>
      <ChipGroup
        label={t('mm.estate.tab.facilities')}
        options={(['pending_approval', 'confirmed', 'all'] as const).map((key) => ({
          key,
          label: t(`mm.facilities.filter.${key}` as MessageKey),
        }))}
        value={filter}
        onChange={setFilter}
      />
      {bookings.isPending ? (
        <>
          <Skeleton height={96} />
          <Skeleton height={96} />
        </>
      ) : null}
      {bookings.isError ? (
        isNetworkError(bookings.error) ? (
          <Banner tone="warning">{t('mm.offline.cached')}</Banner>
        ) : (
          <ErrorState message={errorText(bookings.error)} onRetry={() => void bookings.refetch()} />
        )
      ) : null}
      {bookings.data && bookings.data.length === 0 ? (
        <EmptyState
          icon={<Icon name="calendar-outline" size={28} color={colors.brand.primary} />}
          title={t('mm.facilities.empty')}
          body={t('mm.facilities.emptyBody')}
        />
      ) : null}
      {(bookings.data ?? []).map((booking) => (
        <Card key={booking.id}>
          <View style={{ gap: spacing[2] }}>
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing[2] }}
            >
              <Text style={[styles.cardTitle, { flex: 1 }]}>{booking.facilityName}</Text>
              <StatusPill
                tone={BOOKING_TONE[booking.status] ?? 'neutral'}
                label={t(`mm.facilities.status.${booking.status}` as MessageKey)}
              />
            </View>
            <Text style={styles.muted}>
              {[
                formatDateTime(booking.startsAt),
                booking.guests ? t('mm.facilities.guests', { count: booking.guests }) : null,
                booking.price > 0 ? formatKobo(booking.price) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {booking.purpose ? <Text style={styles.body}>{booking.purpose}</Text> : null}
            {booking.status === 'pending_approval' ? (
              <View style={{ flexDirection: 'row', gap: spacing[2] }}>
                <View style={{ flex: 1 }}>
                  <ActionButton
                    label={t('join.approve')}
                    onPress={() =>
                      setPending({ id: booking.id, name: booking.facilityName, action: 'approve' })
                    }
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <ActionButton
                    label={t('join.reject')}
                    variant="outline"
                    onPress={() => {
                      setReason('');
                      setPending({ id: booking.id, name: booking.facilityName, action: 'reject' });
                    }}
                  />
                </View>
              </View>
            ) : null}
            {booking.status === 'confirmed' ? (
              <View style={{ flexDirection: 'row', gap: spacing[2] }}>
                <View style={{ flex: 1 }}>
                  <ActionButton
                    label={t('mm.facilities.action.checkIn')}
                    onPress={() =>
                      setPending({ id: booking.id, name: booking.facilityName, action: 'check_in' })
                    }
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <ActionButton
                    label={t('mm.facilities.action.noShow')}
                    variant="outline"
                    onPress={() =>
                      setPending({ id: booking.id, name: booking.facilityName, action: 'no_show' })
                    }
                  />
                </View>
              </View>
            ) : null}
          </View>
        </Card>
      ))}
      <ConfirmModal
        visible={pending !== null}
        title={pending?.name ?? ''}
        body={
          pending
            ? pending.action === 'approve'
              ? t('mm.approvals.confirmBody.booking.approve')
              : pending.action === 'reject'
                ? t('mm.approvals.confirmBody.booking.reject')
                : pending.action === 'check_in'
                  ? t('mm.facilities.confirm.checkIn')
                  : pending.action === 'no_show'
                    ? t('mm.facilities.confirm.noShow')
                    : t('mm.facilities.confirm.cancel')
            : ''
        }
        confirmLabel={
          pending?.action === 'approve'
            ? t('join.approve')
            : pending?.action === 'reject'
              ? t('join.reject')
              : pending?.action === 'check_in'
                ? t('mm.facilities.action.checkIn')
                : pending?.action === 'no_show'
                  ? t('mm.facilities.action.noShow')
                  : t('mm.facilities.action.cancel')
        }
        destructive={pending?.action === 'reject' || pending?.action === 'cancel'}
        busy={act.isPending}
        error={act.isError ? errorText(act.error) : null}
        reason={
          needsReason
            ? { label: t('join.reason'), value: reason, onChange: setReason, required: true }
            : undefined
        }
        onConfirm={() => {
          if (!pending) return;
          if (needsReason && reason.trim().length < 3) return;
          act.mutate({ id: pending.id, action: pending.action });
        }}
        onCancel={() => {
          setPending(null);
          act.reset();
        }}
      />
    </>
  );
}

function FinanceSection() {
  const { estateId, can } = useManager();
  const range = monthToDateWat();
  const canReport = can('report.read');
  const summary = useQuery({
    queryKey: ['estate', estateId, 'reports', 'summary', range.from, range.to],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/reports/summary', {
          params: { path: { estateId }, query: range },
        }),
      ),
    enabled: canReport,
  });
  const transactions = useQuery({
    queryKey: ['estate', estateId, 'transactions', 'recent'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/transactions', {
          params: { path: { estateId }, query: { limit: 25 } },
        }),
      ),
    enabled: can('invoice.read') || can('payment.reconcile'),
  });

  const finance = summary.data?.finance;
  const rate =
    finance && finance.billedKobo > 0
      ? `${Math.round((finance.collectedKobo / finance.billedKobo) * 100)}%`
      : '-';

  return (
    <>
      {canReport ? (
        summary.isPending ? (
          <Skeleton height={160} />
        ) : summary.isError ? (
          isNetworkError(summary.error) ? (
            <Banner tone="warning">{t('mm.offline.cached')}</Banner>
          ) : (
            <ErrorState message={errorText(summary.error)} onRetry={() => void summary.refetch()} />
          )
        ) : finance ? (
          <>
            <Card>
              <View style={{ gap: spacing[3] }}>
                <Text style={styles.cardTitle}>{t('mm.finance.collectionsTitle')}</Text>
                <View style={styles.row}>
                  <Text style={styles.muted}>{t('mm.finance.billed')}</Text>
                  <Text style={styles.amount}>{formatKobo(finance.billedKobo)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.muted}>{t('mm.finance.collected')}</Text>
                  <Text style={styles.amount}>{formatKobo(finance.collectedKobo)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.muted}>{t('mm.finance.outstanding')}</Text>
                  <Text style={styles.amount}>{formatKobo(finance.outstandingKobo)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.muted}>{t('mm.finance.rate')}</Text>
                  <Text style={styles.amount}>{rate}</Text>
                </View>
              </View>
            </Card>
            <Card>
              <View style={{ gap: spacing[3] }}>
                <Text style={styles.cardTitle}>{t('mm.finance.ageingTitle')}</Text>
                <View style={styles.row}>
                  <Text style={styles.muted}>{t('mm.finance.ageing.current')}</Text>
                  <Text style={styles.amount}>{formatKobo(finance.ageing.currentKobo)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.muted}>{t('mm.finance.ageing.days30')}</Text>
                  <Text style={styles.amount}>{formatKobo(finance.ageing.days30Kobo)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.muted}>{t('mm.finance.ageing.days60')}</Text>
                  <Text style={styles.amount}>{formatKobo(finance.ageing.days60Kobo)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.muted}>{t('mm.finance.ageing.days90Plus')}</Text>
                  <Text style={styles.amount}>{formatKobo(finance.ageing.days90PlusKobo)}</Text>
                </View>
              </View>
            </Card>
          </>
        ) : null
      ) : null}

      <SectionHeader title={t('mm.finance.transactionsTitle')} />
      {transactions.isPending ? <Skeleton height={80} /> : null}
      {transactions.data && transactions.data.length === 0 ? (
        <Text style={styles.muted}>{t('mm.finance.transactionsEmpty')}</Text>
      ) : null}
      {(transactions.data ?? []).map((tx) => (
        <ListRow
          key={tx.id}
          title={formatKobo(tx.amount)}
          subtitle={[
            tx.channel ?? tx.provider,
            tx.reference,
            tx.paidAt ? formatDateTime(tx.paidAt) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          leading={<Icon name="card-outline" color={colors.brand.primary} size={20} />}
          trailing={
            <StatusPill
              tone={TX_TONE[tx.status] ?? 'neutral'}
              label={t(`mm.finance.txStatus.${tx.status}` as MessageKey)}
            />
          }
        />
      ))}
      <Banner tone="neutral">{t('mm.finance.webOnly')}</Banner>
    </>
  );
}

/** Estate & Finance hub: residents/units, maintenance, facilities, finance (management-mobile.md §6 tab 4). */
export default function EstateScreen() {
  const { section: initialSection } = useLocalSearchParams<{ section?: string }>();
  const queryClient = useQueryClient();
  const { estateId, can, hasFeature } = useManager();

  const canPeople = (hasFeature('occupancy') && can('resident.read')) || can('space.manage');
  const canMaintenance = hasFeature('maintenance') && can('maintenance.assign');
  const canFacilities = hasFeature('facilities') && can('facility.manage');
  const canFinance =
    hasFeature('billing') &&
    (can('report.read') || can('invoice.read') || can('payment.reconcile'));

  const options = useMemo(
    () =>
      [
        canPeople ? { key: 'people' as const, label: t('mm.estate.tab.people') } : null,
        canMaintenance
          ? { key: 'maintenance' as const, label: t('mm.estate.tab.maintenance') }
          : null,
        canFacilities ? { key: 'facilities' as const, label: t('mm.estate.tab.facilities') } : null,
        canFinance ? { key: 'finance' as const, label: t('mm.estate.tab.finance') } : null,
      ].filter((opt): opt is { key: EstateSection; label: string } => opt !== null),
    [canPeople, canMaintenance, canFacilities, canFinance],
  );

  const [selected, setSelected] = useState<EstateSection | null>(null);
  useEffect(() => {
    if (
      initialSection === 'people' ||
      initialSection === 'maintenance' ||
      initialSection === 'facilities' ||
      initialSection === 'finance'
    ) {
      setSelected(initialSection);
    }
  }, [initialSection]);

  const current =
    selected && options.some((opt) => opt.key === selected) ? selected : options[0]?.key;

  const pull = usePullRefresh(() =>
    queryClient.refetchQueries({ queryKey: ['estate', estateId], type: 'active' }),
  );

  if (!current) {
    return (
      <ScrollScreen>
        <ScreenHeader title={t('mm.estate.hubTitle')} />
        <EmptyState
          icon={<Icon name="lock-closed-outline" size={28} color={colors.brand.primary} />}
          title={t('mm.estate.noTabAccess')}
          body={t('mm.estate.noTabAccessBody')}
        />
      </ScrollScreen>
    );
  }

  return (
    <ScrollScreen {...pull}>
      <ScreenHeader title={t('mm.estate.hubTitle')} />
      {options.length > 1 ? (
        <Segmented
          label={t('mm.estate.hubTitle')}
          options={options}
          value={current}
          onChange={setSelected}
        />
      ) : null}
      {current === 'people' ? <PeopleSection /> : null}
      {current === 'maintenance' ? <MaintenanceSection /> : null}
      {current === 'facilities' ? <FacilitiesSection /> : null}
      {current === 'finance' ? <FinanceSection /> : null}
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  cardTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    color: colors.semantic.text,
  },
  body: { fontSize: typography.size.md, color: colors.semantic.text },
  muted: { fontSize: typography.size.sm, color: colors.semantic.textMuted },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing[3] },
  amount: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    color: colors.semantic.text,
    fontVariant: ['tabular-nums'],
  },
});
