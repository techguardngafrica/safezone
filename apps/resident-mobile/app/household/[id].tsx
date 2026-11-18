import { unwrap } from '@safezone/api-client';
import { colors } from '@safezone/design-tokens';
import { type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ChipGroup,
  ConfirmModal,
  ScreenHeader,
  ScrollScreen,
  ToggleRow,
} from '@safezone/mobile-ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Icon } from '../../src/components/icon';
import {
  type MemberPermissions,
  PERMISSION_KEYS,
  RELATIONSHIPS,
  type Relationship,
} from '../../src/features/household';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';

/** Household head edits one member: relationship, what they may do, or removes them. */
export default function MemberScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId, household } = useResident();
  const member = household?.members.find((item) => item.id === id);
  const [relationship, setRelationship] = useState<Relationship>(
    member && member.relationship !== 'head' ? member.relationship : 'other',
  );
  const [permissions, setPermissions] = useState<MemberPermissions | null>(
    member?.permissions ?? null,
  );
  const [removing, setRemoving] = useState(false);
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'households'] });
    router.back();
  };

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PATCH('/v1/estates/{estateId}/household-members/{id}', {
          params: { path: { estateId, id } },
          body: { relationship, ...(permissions ? { permissions } : {}) },
        }),
      ),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: () =>
      unwrap(
        api.DELETE('/v1/estates/{estateId}/household-members/{id}', {
          params: { path: { estateId, id } },
        }),
      ),
    onSuccess: done,
  });

  if (!member || !permissions) {
    return (
      <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
        <ScreenHeader
          title={t('res.household.title')}
          onBack={() => router.back()}
          backIcon={<Icon name="arrow-back" />}
        />
        <Banner tone="info">{t('res.household.memberGone')}</Banner>
      </ScrollScreen>
    );
  }

  return (
    <ScrollScreen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        <ActionButton
          label={t('common.save')}
          onPress={() => save.mutate()}
          busy={save.isPending}
        />
      }
    >
      <ScreenHeader
        title={member.fullName}
        subtitle={member.isMinor ? t('res.household.minor') : undefined}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      <Card>
        <ChipGroup<Relationship>
          label={t('res.household.relationship')}
          value={relationship}
          onChange={setRelationship}
          options={RELATIONSHIPS.map((key) => ({
            key,
            label: t(`resident.relationship.${key}` as MessageKey),
          }))}
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
            onChange={(value) =>
              setPermissions((current) => (current ? { ...current, [key]: value } : current))
            }
          />
        ))}
      </Card>
      {save.isError ? <Banner tone="danger">{errorText(save.error)}</Banner> : null}
      <ActionButton
        label={t('res.household.remove')}
        variant="text"
        onPress={() => setRemoving(true)}
      />
      <ConfirmModal
        visible={removing}
        title={t('res.household.removeTitle', { name: member.fullName })}
        body={t('res.household.removeBody')}
        confirmLabel={t('res.household.remove')}
        cancelLabel={t('res.household.keepMember')}
        destructive
        busy={remove.isPending}
        error={remove.isError ? errorText(remove.error) : null}
        onConfirm={() => remove.mutate()}
        onCancel={() => setRemoving(false)}
      />
    </ScrollScreen>
  );
}
