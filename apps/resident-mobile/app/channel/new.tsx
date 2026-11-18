import { unwrap } from '@safezone/api-client';
import { colors } from '@safezone/design-tokens';
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
import { Text } from 'react-native';
import { Icon } from '../../src/components/icon';
import { errorText } from '../../src/lib/errors';
import { formErrors } from '../../src/lib/form-errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';

type Privacy = 'public' | 'restricted';

/** Start a resident group (a hobby, a street, parents). The estate may approve it first. */
export default function NewGroupScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { estateId } = useResident();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [privacy, setPrivacy] = useState<Privacy>('public');
  const [errors, setErrors] = useState<{ name?: string; description?: string }>({});
  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/channels', {
          params: { path: { estateId } },
          body: {
            name: name.trim(),
            privacy,
            ...(description.trim() ? { description: description.trim() } : {}),
          },
        }),
      ),
    onSuccess: (channel) => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'channels'] });
      if (channel.status === 'active') router.replace(`/channel/${channel.id}`);
      else router.back();
    },
    onError: (error) =>
      setErrors(formErrors(error, { name: 'name', description: 'description' } as const).fields),
  });
  const submit = () => {
    if (name.trim().length < 3) return setErrors({ name: t('res.community.nameRequired') });
    setErrors({});
    create.mutate();
  };
  return (
    <ScrollScreen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        <ActionButton label={t('res.community.create')} onPress={submit} busy={create.isPending} />
      }
    >
      <ScreenHeader
        title={t('res.community.newGroup')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      <Card>
        <TextField
          label={t('res.community.groupName')}
          placeholder={t('res.community.groupNamePlaceholder')}
          value={name}
          onChangeText={(v) => {
            setName(v);
            setErrors((c) => ({ ...c, name: undefined }));
          }}
          error={errors.name}
          maxLength={60}
        />
        <TextField
          label={t('res.community.groupDescription')}
          value={description}
          onChangeText={setDescription}
          error={errors.description}
          multiline
          maxLength={500}
        />
        <ChipGroup<Privacy>
          label={t('res.community.privacy')}
          value={privacy}
          onChange={setPrivacy}
          options={[
            { key: 'public', label: t('res.community.privacy.public') },
            { key: 'restricted', label: t('res.community.privacy.restricted') },
          ]}
        />
        <Text style={{ color: colors.semantic.textMuted, fontSize: 13 }}>
          {privacy === 'public'
            ? t('res.community.privacy.publicHelp')
            : t('res.community.privacy.restrictedHelp')}
        </Text>
      </Card>
      <Text style={{ color: colors.semantic.textMuted, fontSize: 13 }}>
        {t('res.community.approvalNote')}
      </Text>
      {create.isError && !errors.name ? (
        <Banner tone="danger">{errorText(create.error)}</Banner>
      ) : null}
    </ScrollScreen>
  );
}
