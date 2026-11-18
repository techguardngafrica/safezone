import { unwrap } from '@safezone/api-client';
import { colors, typography } from '@safezone/design-tokens';
import { type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ConfirmModal,
  EmptyState,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
  StatusPill,
  type Tone,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import { scheduleText, type Staff } from '../../src/features/household';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

const TONE: Record<Staff['status'], Tone> = {
  pending: 'warning',
  active: 'success',
  suspended: 'neutral',
  ended: 'neutral',
};
/** Domestic staff (cleaners, drivers, nannies): regular access on their days and hours. */
export default function StaffScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { estateId, household } = useResident();
  const [ending, setEnding] = useState<Staff | null>(null);
  const staff = useQuery({
    queryKey: ['estate', estateId, 'domestic-staff', household?.id],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/domestic-staff', {
          params: { path: { estateId }, query: { householdId: household?.id } },
        }),
      ),
    enabled: Boolean(household),
  });
  const pull = usePullRefresh(staff.refetch);
  const setStatus = useMutation({
    mutationFn: ({ person, status }: { person: Staff; status: 'active' | 'suspended' | 'ended' }) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/domestic-staff/{id}/status', {
          params: { path: { estateId, id: person.id } },
          body: { status },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'domestic-staff'] });
      setEnding(null);
    },
  });
  const current = (staff.data ?? []).filter((person) => person.status !== 'ended');

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={t('res.staff.title')}
        subtitle={t('res.staff.subtitle')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      {!household ? <Banner tone="info">{t('res.household.noneBody')}</Banner> : null}
      {staff.isPending && household ? <Skeleton height={100} /> : null}
      {staff.isError ? (
        <ErrorState message={errorText(staff.error)} onRetry={() => void staff.refetch()} />
      ) : null}
      {staff.data && current.length === 0 ? (
        <EmptyState
          icon={<Icon name="people-circle-outline" size={28} color={colors.brand.primary} />}
          title={t('res.staff.empty')}
          body={t('res.staff.emptyBody')}
        />
      ) : null}
      {current.map((person) => (
        <Card key={person.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text
              style={{
                fontSize: typography.size.md,
                fontWeight: '600',
                color: colors.semantic.text,
                flex: 1,
              }}
            >
              {person.name}
            </Text>
            <StatusPill
              tone={TONE[person.status]}
              label={t(`res.staff.status.${person.status}` as MessageKey)}
            />
          </View>
          <Text style={{ color: colors.semantic.textMuted, fontSize: typography.size.sm }}>
            {t(`res.staff.role.${person.role}` as MessageKey)} · {scheduleText(person.schedule)}
          </Text>
          {person.status === 'pending' ? (
            <Text style={{ color: colors.semantic.textMuted, fontSize: typography.size.sm }}>
              {t('res.staff.pendingHelp')}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {person.status === 'active' ? (
              <ActionButton
                label={t('res.staff.suspend')}
                variant="outline"
                busy={
                  setStatus.isPending &&
                  setStatus.variables?.person.id === person.id &&
                  setStatus.variables.status === 'suspended'
                }
                onPress={() => setStatus.mutate({ person, status: 'suspended' })}
              />
            ) : null}
            {person.status === 'suspended' ? (
              <ActionButton
                label={t('res.staff.resume')}
                variant="outline"
                busy={
                  setStatus.isPending &&
                  setStatus.variables?.person.id === person.id &&
                  setStatus.variables.status === 'active'
                }
                onPress={() => setStatus.mutate({ person, status: 'active' })}
              />
            ) : null}
            <ActionButton
              label={t('res.staff.end')}
              variant="text"
              onPress={() => setEnding(person)}
            />
          </View>
        </Card>
      ))}
      {setStatus.isError && !ending ? (
        <Banner tone="danger">{errorText(setStatus.error)}</Banner>
      ) : null}
      {household ? (
        <ActionButton
          label={t('res.staff.add')}
          icon={<Icon name="person-add-outline" color="#FFFFFF" size={20} />}
          onPress={() => router.push('/staff/add')}
        />
      ) : null}
      <ConfirmModal
        visible={Boolean(ending)}
        title={t('res.staff.endTitle', { name: ending?.name ?? '' })}
        body={t('res.staff.endBody')}
        confirmLabel={t('res.staff.end')}
        cancelLabel={t('res.staff.keep')}
        destructive
        busy={setStatus.isPending}
        error={setStatus.isError ? errorText(setStatus.error) : null}
        onConfirm={() => ending && setStatus.mutate({ person: ending, status: 'ended' })}
        onCancel={() => setEnding(null)}
      />
    </ScrollScreen>
  );
}
