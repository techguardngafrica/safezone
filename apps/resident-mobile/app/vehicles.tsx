import { unwrap } from '@safezone/api-client';
import { colors } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ConfirmModal,
  EmptyState,
  ErrorState,
  ListRow,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
  TextField,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable } from 'react-native';
import { Icon } from '../src/components/icon';
import {
  checkPlate,
  VEHICLE_FIELD_PATHS,
  type Vehicle,
  type VehicleInput,
} from '../src/features/household';
import { errorText } from '../src/lib/errors';
import { formErrors } from '../src/lib/form-errors';
import { useResident } from '../src/lib/resident';
import { api } from '../src/lib/session';
import { usePullRefresh } from '../src/lib/use-pull-refresh';

/** Household vehicles: guards see plate, make, model and colour only (AGENTS §6 rule 5). */
export default function VehiclesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { estateId, household } = useResident();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ plate: '', make: '', model: '', colour: '', tagNumber: '' });
  const [errors, setErrors] = useState<Partial<Record<VehicleInput, string>>>({});
  const [other, setOther] = useState<string[]>([]);
  const [removing, setRemoving] = useState<Vehicle | null>(null);

  const vehicles = useQuery({
    queryKey: ['estate', estateId, 'vehicles', household?.id],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/vehicles', {
          params: { path: { estateId }, query: { householdId: household?.id ?? '' } },
        }),
      ),
    enabled: Boolean(household),
  });
  const pull = usePullRefresh(vehicles.refetch);
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'vehicles'] });

  const register = useMutation({
    mutationFn: (plate: string) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/vehicles', {
          params: { path: { estateId } },
          body: {
            householdId: household?.id ?? '',
            plate,
            ...(form.make.trim() ? { make: form.make.trim() } : {}),
            ...(form.model.trim() ? { model: form.model.trim() } : {}),
            ...(form.colour.trim() ? { colour: form.colour.trim() } : {}),
            ...(form.tagNumber.trim() ? { tagNumber: form.tagNumber.trim() } : {}),
          },
        }),
      ),
    onSuccess: () => {
      refresh();
      setAdding(false);
      setForm({ plate: '', make: '', model: '', colour: '', tagNumber: '' });
    },
    onError: (error) => {
      const server = formErrors(error, VEHICLE_FIELD_PATHS);
      setErrors(server.fields);
      setOther(server.other);
    },
  });
  const deactivate = useMutation({
    mutationFn: (vehicle: Vehicle) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/vehicles/{id}/deactivate', {
          params: { path: { estateId, id: vehicle.id } },
        }),
      ),
    onSuccess: () => {
      refresh();
      setRemoving(null);
    },
  });

  const edit = (key: VehicleInput) => (value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  };
  const submit = () => {
    setOther([]);
    const checked = checkPlate(form.plate);
    if (!checked.ok) return setErrors({ plate: checked.error });
    setErrors({});
    register.mutate(checked.plate);
  };
  const list = (vehicles.data ?? []).filter((vehicle) => vehicle.status === 'active');

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={t('res.vehicles.title')}
        subtitle={t('res.vehicles.subtitle')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      {!household ? <Banner tone="info">{t('res.household.noneBody')}</Banner> : null}
      {vehicles.isPending && household ? <Skeleton height={80} /> : null}
      {vehicles.isError ? (
        <ErrorState message={errorText(vehicles.error)} onRetry={() => void vehicles.refetch()} />
      ) : null}
      {vehicles.data && list.length === 0 && !adding ? (
        <EmptyState
          icon={<Icon name="car-outline" size={28} color={colors.brand.primary} />}
          title={t('res.vehicles.empty')}
          body={t('res.vehicles.emptyBody')}
        />
      ) : null}
      {list.length > 0 ? (
        <Card>
          {list.map((vehicle) => (
            <ListRow
              key={vehicle.id}
              title={vehicle.plate}
              subtitle={[
                vehicle.colour,
                vehicle.make,
                vehicle.model,
                vehicle.tagNumber ? t('res.vehicles.tag', { tag: vehicle.tagNumber }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              leading={<Icon name="car-outline" color={colors.brand.primary} size={20} />}
              trailing={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('res.vehicles.removeLabel', { plate: vehicle.plate })}
                  onPress={() => setRemoving(vehicle)}
                  style={{
                    minWidth: 48,
                    minHeight: 48,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="trash-outline" color={colors.semantic.textMuted} size={20} />
                </Pressable>
              }
            />
          ))}
        </Card>
      ) : null}
      {adding ? (
        <Card>
          <TextField
            label={t('res.vehicles.plate')}
            placeholder="LND 123 AB"
            value={form.plate}
            onChangeText={edit('plate')}
            autoCapitalize="characters"
            error={errors.plate}
            maxLength={18}
            autoFocus
          />
          <TextField
            label={t('res.vehicles.colour')}
            value={form.colour}
            onChangeText={edit('colour')}
            error={errors.colour}
            maxLength={30}
          />
          <TextField
            label={t('res.vehicles.make')}
            placeholder="Toyota"
            value={form.make}
            onChangeText={edit('make')}
            error={errors.make}
            maxLength={40}
          />
          <TextField
            label={t('res.vehicles.model')}
            placeholder="Corolla"
            value={form.model}
            onChangeText={edit('model')}
            error={errors.model}
            maxLength={40}
          />
          <TextField
            label={t('res.vehicles.tagNumber')}
            helper={t('res.vehicles.tagHelp')}
            value={form.tagNumber}
            onChangeText={edit('tagNumber')}
            error={errors.tagNumber}
            maxLength={30}
          />
          {other.map((message) => (
            <Banner key={message} tone="danger">
              {message}
            </Banner>
          ))}
          {register.isError &&
          Object.values(errors).every((value) => !value) &&
          other.length === 0 ? (
            <Banner tone="danger">{errorText(register.error)}</Banner>
          ) : null}
          <ActionButton label={t('res.vehicles.save')} onPress={submit} busy={register.isPending} />
          <ActionButton
            label={t('common.cancel')}
            variant="text"
            onPress={() => setAdding(false)}
          />
        </Card>
      ) : household ? (
        <ActionButton
          label={t('res.vehicles.add')}
          variant="outline"
          onPress={() => setAdding(true)}
        />
      ) : null}
      <ConfirmModal
        visible={Boolean(removing)}
        title={t('res.vehicles.removeTitle', { plate: removing?.plate ?? '' })}
        body={t('res.vehicles.removeBody')}
        confirmLabel={t('res.vehicles.remove')}
        cancelLabel={t('res.vehicles.keep')}
        destructive
        busy={deactivate.isPending}
        error={deactivate.isError ? errorText(deactivate.error) : null}
        onConfirm={() => removing && deactivate.mutate(removing)}
        onCancel={() => setRemoving(null)}
      />
    </ScrollScreen>
  );
}
