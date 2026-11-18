import { unwrap } from '@safezone/api-client';
import { colors } from '@safezone/design-tokens';
import { type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  CheckboxRow,
  ChipGroup,
  ScreenHeader,
  ScrollScreen,
  TextField,
  ToggleRow,
} from '@safezone/mobile-ui';
import { normalizeNigerianPhone } from '@safezone/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Icon } from '../../src/components/icon';
import {
  checkMember,
  MEMBER_FIELD_PATHS,
  type MemberInput,
  type MemberPermissions,
  PERMISSION_KEYS,
  RELATIONSHIPS,
  type Relationship,
} from '../../src/features/household';
import { errorText } from '../../src/lib/errors';
import { formErrors } from '../../src/lib/form-errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';

/** What a new member may do by default: adults everything, children only receive gate alerts. */
function defaults(isMinor: boolean): MemberPermissions {
  return {
    inviteVisitors: !isMinor,
    triggerSos: true,
    viewBills: !isMinor,
    payBills: false,
    receiveGateAlerts: !isMinor,
  };
}

export default function AddMemberScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { estateId, household } = useResident();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState<Relationship>('spouse');
  const [isMinor, setIsMinor] = useState(false);
  const [permissions, setPermissions] = useState<MemberPermissions>(defaults(false));
  const [errors, setErrors] = useState<Partial<Record<MemberInput, string>>>({});
  const [other, setOther] = useState<string[]>([]);

  const add = useMutation({
    mutationFn: (input: { fullName: string; phone?: string }) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/households/{id}/members', {
          params: { path: { estateId, id: household?.id ?? '' } },
          body: { ...input, relationship, isMinor, permissions },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'households'] });
      router.back();
    },
    onError: (error) => {
      const server = formErrors(error, MEMBER_FIELD_PATHS);
      setErrors(server.fields);
      setOther(server.other);
    },
  });

  const submit = () => {
    setOther([]);
    const checked = checkMember({ fullName, phone, isMinor }, normalizeNigerianPhone);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    add.mutate({ fullName: checked.fullName, ...(checked.phone ? { phone: checked.phone } : {}) });
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
            label={t('res.household.addSubmit')}
            onPress={submit}
            busy={add.isPending}
            disabled={!household}
          />
        </>
      }
    >
      <ScreenHeader
        title={t('res.household.add')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      <Card>
        <TextField
          label={t('res.join.fullName')}
          value={fullName}
          onChangeText={(value) => {
            setFullName(value);
            if (errors.fullName) setErrors((current) => ({ ...current, fullName: undefined }));
          }}
          autoCapitalize="words"
          error={errors.fullName}
          maxLength={120}
        />
        <ChipGroup<Relationship>
          label={t('res.household.relationship')}
          value={relationship}
          onChange={setRelationship}
          options={RELATIONSHIPS.map((key) => ({
            key,
            label: t(`resident.relationship.${key}` as MessageKey),
          }))}
        />
        <CheckboxRow
          label={t('res.household.isMinor')}
          checked={isMinor}
          onChange={(value) => {
            setIsMinor(value);
            setPermissions(defaults(value));
            if (errors.phone) setErrors((current) => ({ ...current, phone: undefined }));
          }}
        />
        <TextField
          label={isMinor ? t('res.household.phoneOptional') : t('auth.phone.label')}
          helper={isMinor ? undefined : t('res.household.phoneHelp')}
          placeholder={t('auth.phone.placeholder')}
          value={phone}
          onChangeText={(value) => {
            setPhone(value);
            if (errors.phone) setErrors((current) => ({ ...current, phone: undefined }));
          }}
          keyboardType="phone-pad"
          error={errors.phone}
          maxLength={20}
        />
      </Card>
      <Card>
        <Text style={{ fontWeight: '600', color: colors.semantic.text }}>
          {t('res.household.permissionsTitle')}
        </Text>
        {PERMISSION_KEYS.map((key) => (
          <ToggleRow
            key={key}
            label={t(`res.household.perm.${key}` as MessageKey)}
            value={permissions[key]}
            onChange={(value) => setPermissions((current) => ({ ...current, [key]: value }))}
          />
        ))}
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
