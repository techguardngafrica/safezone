import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ChipGroup,
  ScreenHeader,
  ScrollScreen,
  TextField,
} from '@safezone/mobile-ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Icon } from '../../src/components/icon';
import { todayWat } from '../../src/features/bills';
import {
  isValidIsoDate,
  type MoveType,
  parseVehiclePlates,
  vehiclePlatesValid,
} from '../../src/features/moves';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';

/** Schedule a move-in or move-out with gate notice details. */
export default function NewMoveScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { estateId, household } = useResident();
  const [type, setType] = useState<MoveType>('move_in');
  const [scheduledOn, setScheduledOn] = useState(todayWat());
  const [items, setItems] = useState('');
  const [vehicles, setVehicles] = useState('');
  const [notes, setNotes] = useState('');

  const occupancyId = household?.occupancy?.id;
  const plates = parseVehiclePlates(vehicles);
  const platesOk = vehiclePlatesValid(plates);

  const submit = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/moves', {
          params: { path: { estateId } },
          body: {
            type,
            occupancyId: occupancyId ?? '',
            scheduledOn: scheduledOn.trim(),
            gateNotice: {
              ...(items.trim() ? { items: items.trim() } : {}),
              vehicles: plates,
              ...(notes.trim() ? { notes: notes.trim() } : {}),
            },
          },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'moves'] });
      router.back();
    },
  });

  const valid = Boolean(occupancyId) && isValidIsoDate(scheduledOn.trim()) && platesOk;

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        title={t('res.moves.newTitle')}
        subtitle={household?.unit.code}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />

      {!occupancyId ? <Banner tone="warning">{t('res.moves.noOccupancy')}</Banner> : null}

      <Card>
        <ChipGroup<MoveType>
          label={t('res.moves.moveType')}
          value={type}
          onChange={setType}
          options={[
            { key: 'move_in', label: t('res.moves.type.move_in') },
            { key: 'move_out', label: t('res.moves.type.move_out') },
          ]}
        />
        <TextField
          label={t('res.moves.scheduledOn')}
          placeholder={t('res.moves.scheduledOnPlaceholder')}
          value={scheduledOn}
          onChangeText={setScheduledOn}
          maxLength={10}
        />
        <TextField
          label={t('res.moves.itemsLabel')}
          placeholder={t('res.moves.itemsPlaceholder')}
          value={items}
          onChangeText={setItems}
          maxLength={300}
        />
        <TextField
          label={t('res.moves.vehiclesLabel')}
          placeholder={t('res.moves.vehiclesPlaceholder')}
          helper={t('res.moves.vehiclesHelp')}
          error={platesOk ? null : t('res.moves.vehiclesInvalid')}
          value={vehicles}
          onChangeText={setVehicles}
          autoCapitalize="characters"
          maxLength={100}
        />
        <TextField
          label={t('res.moves.notesLabel')}
          placeholder={t('res.moves.notesPlaceholder')}
          value={notes}
          onChangeText={setNotes}
          multiline
          maxLength={500}
        />
        {submit.isError ? <Banner tone="danger">{errorText(submit.error)}</Banner> : null}
        <ActionButton
          label={t('res.moves.submit')}
          disabled={!valid}
          busy={submit.isPending}
          onPress={() => submit.mutate()}
        />
      </Card>
    </ScrollScreen>
  );
}
