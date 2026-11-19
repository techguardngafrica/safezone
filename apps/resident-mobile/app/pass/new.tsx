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
import { normalizeNigerianPhone } from '@safezone/schemas';
import { useMemo, useRef, useState } from 'react';
import { Text } from 'react-native';
import { Icon } from '../../src/components/icon';
import {
  type ArrivalWindow,
  availableWindows,
  checkVisitor,
  parseGuestList,
  passValidity,
  VISITOR_FIELD_PATHS,
  type VisitorInput,
} from '../../src/features/passes';
import { errorText } from '../../src/lib/errors';
import { formErrors } from '../../src/lib/form-errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';

type PassKind = 'one_time' | 'multi_entry' | 'event';
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
  const [eventName, setEventName] = useState('');
  const [guestText, setGuestText] = useState('');
  const [eventErrors, setEventErrors] = useState<{ name?: string; guests?: string }>({});
  const guestList = useMemo(() => parseGuestList(guestText), [guestText]);
  const [day, setDay] = useState(0);
  const [window, setWindow] = useState<ArrivalWindow>('next4');
  const [gateId, setGateId] = useState<string>('any');
  const [errors, setErrors] = useState<Partial<Record<VisitorInput, string>>>({});
  const [otherErrors, setOtherErrors] = useState<string[]>([]);
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

  /** Edits a field and clears its error, so the message goes away as soon as the user fixes it. */
  const edit = (input: VisitorInput, setter: (value: string) => void) => (value: string) => {
    setter(value);
    if (errors[input]) setErrors((current) => ({ ...current, [input]: undefined }));
  };

  const create = useMutation({
    mutationFn: (
      who:
        | { visitor: { name: string; phone?: string; vehiclePlate?: string } }
        | { event: { name: string; guests: string[] } },
    ) => {
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
            // An event is one pass for the event with a guest list (visitor.md §3).
            ...('event' in who ? { event: who.event } : { visitors: [who.visitor] }),
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
    onError: (error) => {
      // A new attempt after a failure is a new request.
      idempotencyKey.current = newIdempotencyKey();
      // Anything the checks below missed: show the API's message on the matching input.
      const server = formErrors(error, VISITOR_FIELD_PATHS);
      setErrors(server.fields);
      setOtherErrors(server.other);
    },
  });

  const submit = () => {
    setOtherErrors([]);
    if (kind === 'event') {
      const next: { name?: string; guests?: string } = {};
      if (eventName.trim().length < 2) next.name = t('res.newPass.eventNameRequired');
      if (guestList.invalid.length > 0)
        next.guests = t('res.newPass.guestsInvalid', { names: guestList.invalid.join(', ') });
      else if (guestList.guests.length === 0) next.guests = t('res.newPass.guestsRequired');
      else if (guestList.guests.length > 300) next.guests = t('res.newPass.guestsTooMany');
      setEventErrors(next);
      if (next.name || next.guests) return;
      create.mutate({ event: { name: eventName.trim(), guests: guestList.guests } });
      return;
    }
    const checked = checkVisitor({ name, phone, plate }, normalizeNigerianPhone);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    create.mutate({ visitor: checked.visitor });
  };
  const invalidCount =
    (kind === 'event'
      ? Object.values(eventErrors).filter(Boolean).length
      : Object.values(errors).filter(Boolean).length) + otherErrors.length;

  return (
    <ScrollScreen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        <>
          {invalidCount > 0 ? (
            <Text
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={{ color: colors.status.danger, fontSize: 14, marginBottom: 8 }}
            >
              {invalidCount === 1
                ? t('res.newPass.fixOne')
                : t('res.newPass.fixMany', { count: invalidCount })}
            </Text>
          ) : null}
          <ActionButton label={t('res.newPass.create')} onPress={submit} busy={create.isPending} />
        </>
      }
    >
      <ScreenHeader
        title={t('res.newPass.title')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      {kind === 'event' ? (
        <Card>
          <TextField
            label={t('res.newPass.eventName')}
            placeholder={t('res.newPass.eventNamePlaceholder')}
            value={eventName}
            onChangeText={setEventName}
            autoCapitalize="sentences"
            error={eventErrors.name}
            maxLength={120}
          />
          <TextField
            label={t('res.newPass.guests')}
            helper={
              guestList.guests.length > 0
                ? `${t('res.newPass.guestsCount', { count: guestList.guests.length })}. ${t('res.newPass.guestsHelp')}`
                : t('res.newPass.guestsHelp')
            }
            value={guestText}
            onChangeText={setGuestText}
            autoCapitalize="words"
            multiline
            error={eventErrors.guests}
            maxLength={20000}
          />
        </Card>
      ) : null}
      <Card style={kind === 'event' ? { display: 'none' } : undefined}>
        <TextField
          label={t('res.newPass.name')}
          value={name}
          onChangeText={edit('name', setName)}
          autoCapitalize="words"
          error={errors.name}
          maxLength={120}
        />
        <TextField
          label={t('res.newPass.phone')}
          helper={t('res.newPass.phoneHelp')}
          value={phone}
          onChangeText={edit('phone', setPhone)}
          keyboardType="phone-pad"
          placeholder={t('auth.phone.placeholder')}
          error={errors.phone}
          maxLength={20}
        />
        <TextField
          label={t('res.newPass.plate')}
          value={plate}
          onChangeText={edit('plate', setPlate)}
          autoCapitalize="characters"
          helper={t('res.newPass.plateHelp')}
          error={errors.plate}
          maxLength={18}
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
            { key: 'event', label: t('res.newPass.kind.event') },
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
      {otherErrors.map((message) => (
        <Banner key={message} tone="danger">
          {message}
        </Banner>
      ))}
      {create.isError && invalidCount === 0 ? (
        <Banner tone="danger">{errorText(create.error)}</Banner>
      ) : null}
      <Text style={{ color: colors.semantic.textMuted, fontSize: 13 }}>
        {t('res.newPass.footnote')}
      </Text>
    </ScrollScreen>
  );
}
