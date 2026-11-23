import { unwrap, unwrapPage } from '@safezone/api-client';
import { maskPhone } from '@safezone/auth';
import { colors, spacing, typography } from '@safezone/design-tokens';
import { type MessageKey, formatTime, t } from '@safezone/i18n';
import {
  ActionButton,
  Card,
  ListRow,
  ScreenHeader,
  ScrollScreen,
  SectionHeader,
  Skeleton,
  StatusPill,
} from '@safezone/mobile-ui';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Linking, Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import { useManager } from '../../src/lib/manager';
import { api } from '../../src/lib/session';

/** Resident profile detail (management-mobile.md §7.3). Phone masked unless `pii.view`. */
export default function ResidentDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string;
    name?: string;
    unitCode?: string;
    unitId?: string;
    relationship?: string;
    phone?: string;
    householdId?: string;
  }>();
  const { estateId, can, hasFeature } = useManager();
  const showPhone = can('pii.view');

  const household = useQuery({
    queryKey: ['estate', estateId, 'households', params.householdId],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/households/{id}', {
          params: { path: { estateId, id: params.householdId ?? '' } },
        }),
      ),
    enabled: Boolean(params.householdId) && hasFeature('occupancy'),
  });

  const vehicles = useQuery({
    queryKey: ['estate', estateId, 'vehicles', params.householdId],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/vehicles', {
          params: { path: { estateId }, query: { householdId: params.householdId ?? '' } },
        }),
      ),
    enabled: Boolean(params.householdId) && hasFeature('occupancy'),
  });

  const passes = useQuery({
    queryKey: ['estate', estateId, 'visitor-passes', 'active', params.unitId],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/visitor-passes', {
          params: { path: { estateId }, query: { status: 'active', limit: 30 } },
        }),
      ),
    enabled: hasFeature('visitors') && can('visitor.log.read'),
  });

  const unitVehicles = vehicles.data ?? [];
  const unitPasses = (passes.data?.items ?? []).filter(
    (p) => !params.householdId || p.hostHouseholdId === params.householdId,
  );

  const phoneDisplay = params.phone
    ? showPhone
      ? params.phone
      : maskPhone(params.phone)
    : t('resident.noAccount');

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        title={params.name ?? t('mm.estate.residentDetail')}
        subtitle={[
          params.unitCode,
          params.relationship
            ? t(`resident.relationship.${params.relationship}` as MessageKey)
            : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />

      <Card>
        <View style={{ gap: spacing[3] }}>
          <Text style={{ fontSize: typography.size.md, color: colors.semantic.text }}>
            {phoneDisplay}
          </Text>
          {showPhone && params.phone ? (
            <ActionButton
              label={t('mm.estate.call', { name: params.name ?? '' })}
              icon={<Icon name="call-outline" size={18} color={colors.brand.onPrimary} />}
              onPress={() => void Linking.openURL(`tel:${params.phone}`)}
            />
          ) : null}
        </View>
      </Card>

      {params.householdId ? (
        <>
          <SectionHeader title={t('mm.estate.household')} />
          {household.isPending ? <Skeleton height={64} /> : null}
          {household.data && household.data.members.length === 0 ? (
            <Text style={{ fontSize: typography.size.sm, color: colors.semantic.textMuted }}>
              {t('mm.estate.householdEmpty')}
            </Text>
          ) : null}
          {(household.data?.members ?? []).map((member) => (
            <ListRow
              key={member.id}
              title={member.fullName ?? t('mm.approvals.unknownName')}
              subtitle={t(`resident.relationship.${member.relationship}` as MessageKey)}
              leading={<Icon name="person-outline" color={colors.brand.primary} size={20} />}
            />
          ))}
        </>
      ) : null}

      <SectionHeader title={t('mm.estate.vehicles')} />
      {vehicles.isPending ? <Skeleton height={64} /> : null}
      {vehicles.data && unitVehicles.length === 0 ? (
        <Text style={{ fontSize: typography.size.sm, color: colors.semantic.textMuted }}>
          {t('mm.estate.vehiclesEmpty')}
        </Text>
      ) : null}
      {unitVehicles.map((vehicle) => (
        <ListRow
          key={vehicle.id}
          title={vehicle.plate}
          subtitle={[vehicle.make, vehicle.model, vehicle.colour].filter(Boolean).join(' · ')}
          leading={<Icon name="car-outline" color={colors.brand.primary} size={20} />}
        />
      ))}

      {hasFeature('visitors') && can('visitor.log.read') ? (
        <>
          <SectionHeader title={t('mm.estate.activePasses')} />
          {passes.isPending ? <Skeleton height={64} /> : null}
          {passes.data && unitPasses.length === 0 ? (
            <Text style={{ fontSize: typography.size.sm, color: colors.semantic.textMuted }}>
              {t('mm.estate.activePassesEmpty')}
            </Text>
          ) : null}
          {unitPasses.map((pass) => (
            <ListRow
              key={pass.id}
              title={pass.visitorName}
              subtitle={`${formatTime(pass.validFrom)} - ${formatTime(pass.validTo)}`}
              leading={<Icon name="ticket-outline" color={colors.brand.primary} size={20} />}
              trailing={
                <StatusPill tone="info" label={t(`passes.type.${pass.type}` as MessageKey)} />
              }
            />
          ))}
        </>
      ) : null}
    </ScrollScreen>
  );
}
