import { newIdempotencyKey, unwrap } from '@safezone/api-client';
import { colors } from '@safezone/design-tokens';
import { formatDate, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ChipGroup,
  ScreenHeader,
  ScrollScreen,
  TextField,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Text } from 'react-native';
import { Icon } from '../../src/components/icon';
import { type ArrivalWindow, availableWindows, passValidity } from '../../src/features/passes';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';

type PassKind = 'one_time' | 'multi_entry';
const DAYS = [0, 1, 2, 3, 4, 5, 6];

function dayLabel(offset: number): string {
  if (offset === 0) return t('res.newPass.today');
  if (offset === 1) return t('res.newPass.tomorrow');
  return formatDate(new Date(Date.now() + offset * 86_400_000).toISOString());
}

/** Invite a visitor: who, when and how often. The pass, PIN and QR open next (no ads, §8.1). */
export default function NewPassScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { estateId, household, hasFeature } = useResident();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [plate, setPlate] = useState('');
  const [kind, setKind] = useState<PassKind>('one_time');
  const [day, setDay] = useState(0);
  const [window, setWindow] = useState<ArrivalWindow>('next4');
  const [gateId, setGateId] = useState<string>('any');
  const [nameError, setNameError] = useState<string | null>(null);
  const idempotencyKey = useRef(newIdempotencyKey());

  const windows = useMemo(() => availableWindows(day), [day]);
  const chosenWindow = windows.includes(window) ? window : (windows[0] ?? 'allDay');

  const gates = useQuery({
    queryKey: ['estate', estateId, 'gates'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/gates', { params: { path: { estateId } } })),
    enabled: hasFeature('security'),
  });
  const openGates = (gates.data ?? []).filter((gate) => gate.status === 'active');

  const create = useMutation({
    mutationFn: () => {
      const { validFrom, validTo } = passValidity(day, chosenWindow);
      return unwrap(
        api.POST('/v1/estates/{estateId}/visitor-invitations', {
          params: { path: { estateId } },
          headers: { 'Idempotency-Key': idempotencyKey.current },
          body: {
            householdId: household?.id,
            type: kind,
            validFrom,
            validTo,
            gateIds: gateId === 'any' ? undefined : [gateId],
            visitors: [
              {
                name: name.trim(),
                phone: phone.trim() || undefined,
                vehiclePlate: plate.trim().toUpperCase() || undefined,
              },
            ],
          },
        }),
      );
    },
    onSuccess: (passes) => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'visitor-passes'] });
      const first = passes[0];
      if (first) {
        queryClient.setQueryData(['estate', estateId, 'visitor-pass', first.id], first);
        router.replace(`/pass/${first.id}`);
      } else router.back();
    },
    onError: () => {
      // A new attempt after a failure is a new request.
      idempotencyKey.current = newIdempotencyKey();
    },
  });

  const submit = () => {
    if (name.trim().length < 2) return setNameError(t('res.newPass.nameRequired'));
    setNameError(null);
    create.mutate();
  };

  return (
    <ScrollScreen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        <ActionButton label={t('res.newPass.create')} onPress={submit} busy={create.isPending} />
      }
    >
      <ScreenHeader
        title={t('res.newPass.title')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      <Card>
        <TextField
          label={t('res.newPass.name')}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          error={nameError}
          maxLength={120}
        />
        <TextField
          label={t('res.newPass.phone')}
          helper={t('res.newPass.phoneHelp')}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          maxLength={20}
        />
        <TextField
          label={t('res.newPass.plate')}
          value={plate}
          onChangeText={setPlate}
          autoCapitalize="characters"
          maxLength={12}
        />
      </Card>
      <Card>
        <ChipGroup<string>
          label={t('res.newPass.day')}
          value={String(day)}
          onChange={(value) => setDay(Number(value))}
          options={DAYS.map((offset) => ({ key: String(offset), label: dayLabel(offset) }))}
        />
        <ChipGroup<ArrivalWindow>
          label={t('res.newPass.window')}
          value={chosenWindow}
          onChange={setWindow}
          options={windows.map((key) => ({
            key,
            label: t(`res.newPass.window.${key}` as MessageKey),
          }))}
        />
        <ChipGroup<PassKind>
          label={t('res.newPass.kind')}
          value={kind}
          onChange={setKind}
          options={[
            { key: 'one_time', label: t('res.newPass.kind.one_time') },
            { key: 'multi_entry', label: t('res.newPass.kind.multi_entry') },
          ]}
        />
        {openGates.length > 1 ? (
          <ChipGroup<string>
            label={t('res.newPass.gate')}
            value={gateId}
            onChange={setGateId}
            options={[
              { key: 'any', label: t('res.newPass.anyGate') },
              ...openGates.map((gate) => ({ key: gate.id, label: gate.name })),
            ]}
          />
        ) : null}
      </Card>
      {!household ? <Banner tone="warning">{t('res.newPass.noHousehold')}</Banner> : null}
      {create.isError ? <Banner tone="danger">{errorText(create.error)}</Banner> : null}
      <Text style={{ color: colors.semantic.textMuted, fontSize: 13 }}>
        {t('res.newPass.footnote')}
      </Text>
    </ScrollScreen>
  );
}
