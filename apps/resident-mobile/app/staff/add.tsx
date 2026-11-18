import { unwrap } from '@safezone/api-client';
import { colors } from '@safezone/design-tokens';
import { type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ChipGroup,
  MultiChipGroup,
  ScreenHeader,
  ScrollScreen,
  TextField,
} from '@safezone/mobile-ui';
import { normalizeNigerianPhone } from '@safezone/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import {
  checkStaff,
  STAFF_FIELD_PATHS,
  STAFF_ROLES,
  type StaffInput,
  type StaffRole,
} from '../../src/features/household';
import { errorText } from '../../src/lib/errors';
import { formErrors } from '../../src/lib/form-errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';

const DAYS = [
  { key: '1', day: 'mon' },
  { key: '2', day: 'tue' },
  { key: '3', day: 'wed' },
  { key: '4', day: 'thu' },
  { key: '5', day: 'fri' },
  { key: '6', day: 'sat' },
  { key: '0', day: 'sun' },
] as const;

export default function AddStaffScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { estateId, household } = useResident();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<StaffRole>('cleaner');
  const [days, setDays] = useState<string[]>(['1', '2', '3', '4', '5']);
  const [from, setFrom] = useState('08:00');
  const [to, setTo] = useState('17:00');
  const [errors, setErrors] = useState<Partial<Record<StaffInput, string>>>({});
  const [other, setOther] = useState<string[]>([]);

  const add = useMutation({
    mutationFn: (input: {
      name: string;
      phone?: string;
      schedule: { days: number[]; from: string; to: string };
    }) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/domestic-staff', {
          params: { path: { estateId } },
          body: { householdId: household?.id ?? '', role, ...input },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'domestic-staff'] });
      router.back();
    },
    onError: (error) => {
      const server = formErrors(error, STAFF_FIELD_PATHS);
      setErrors(server.fields);
      setOther(server.other);
    },
  });

  const clear = (key: StaffInput) => {
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  };
  const submit = () => {
    setOther([]);
    const checked = checkStaff(
      { name, phone, days: days.map(Number), from, to },
      normalizeNigerianPhone,
    );
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const { ok: _ok, ...input } = checked;
    add.mutate(input);
  };
  const invalid = Object.values(errors).filter(Boolean).length + other.length;

  return (
    <ScrollScreen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        <>
          {invalid > 0 ? (
            <Text
              accessibilityRole="alert"
              style={{ color: colors.status.danger, fontSize: 14, marginBottom: 8 }}
            >
              {invalid === 1
                ? t('res.newPass.fixOne')
                : t('res.newPass.fixMany', { count: invalid })}
            </Text>
          ) : null}
          <ActionButton
            label={t('res.staff.addSubmit')}
            onPress={submit}
            busy={add.isPending}
            disabled={!household}
          />
        </>
      }
    >
      <ScreenHeader
        title={t('res.staff.add')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      <Card>
        <TextField
          label={t('res.contacts.name')}
          value={name}
          onChangeText={(v) => {
            setName(v);
            clear('name');
          }}
          autoCapitalize="words"
          error={errors.name}
          maxLength={120}
        />
        <TextField
          label={t('res.household.phoneOptional')}
          helper={t('res.staff.phoneHelp')}
          placeholder={t('auth.phone.placeholder')}
          value={phone}
          onChangeText={(v) => {
            setPhone(v);
            clear('phone');
          }}
          keyboardType="phone-pad"
          error={errors.phone}
          maxLength={20}
        />
        <ChipGroup<StaffRole>
          label={t('res.staff.roleLabel')}
          value={role}
          onChange={setRole}
          options={STAFF_ROLES.map((key) => ({
            key,
            label: t(`res.staff.role.${key}` as MessageKey),
          }))}
        />
      </Card>
      <Card>
        <MultiChipGroup<string>
          label={t('res.staff.days')}
          value={days}
          onChange={(value) => {
            setDays(value);
            clear('days');
          }}
          options={DAYS.map((item) => ({
            key: item.key,
            label: t(`res.staff.day.${item.day}` as MessageKey),
          }))}
          error={errors.days}
        />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <TextField
              label={t('res.staff.from')}
              placeholder="08:00"
              value={from}
              onChangeText={(v) => {
                setFrom(v);
                clear('from');
              }}
              keyboardType="number-pad"
              error={errors.from}
              maxLength={5}
            />
          </View>
          <View style={{ flex: 1 }}>
            <TextField
              label={t('res.staff.to')}
              placeholder="17:00"
              value={to}
              onChangeText={(v) => {
                setTo(v);
                clear('to');
              }}
              keyboardType="number-pad"
              error={errors.to}
              maxLength={5}
            />
          </View>
        </View>
        <Text style={{ color: colors.semantic.textMuted, fontSize: 13 }}>
          {t('res.staff.timesHelp')}
        </Text>
      </Card>
      {other.map((message) => (
        <Banner key={message} tone="danger">
          {message}
        </Banner>
      ))}
      {add.isError && invalid === 0 ? <Banner tone="danger">{errorText(add.error)}</Banner> : null}
    </ScrollScreen>
  );
}
