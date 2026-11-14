import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ScreenHeader,
  ScrollScreen,
  TextField,
  useSession,
} from '@safezone/mobile-ui';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Icon } from '../src/components/icon';
import { errorText } from '../src/lib/errors';
import { api, session } from '../src/lib/session';

export default function ProfileScreen() {
  const router = useRouter();
  const user = useSession(session).user;
  const [name, setName] = useState(user?.fullName ?? '');
  const save = useMutation({
    mutationFn: () => unwrap(api.PATCH('/v1/me', { body: { fullName: name.trim() } })),
    onSuccess: () => void session.restore(),
  });
  return (
    <ScrollScreen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        <ActionButton
          label={t('common.save')}
          onPress={() => save.mutate()}
          busy={save.isPending}
          disabled={name.trim().length < 2}
        />
      }
    >
      <ScreenHeader
        title={t('res.profile.title')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      <Card>
        <TextField
          label={t('res.join.fullName')}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          maxLength={120}
        />
        <TextField
          label={t('auth.phone.label')}
          value={user?.phone ?? ''}
          onChangeText={() => undefined}
          editable={false}
          helper={t('res.profile.phoneHelp')}
        />
      </Card>
      {save.isSuccess ? <Banner tone="success">{t('settings.saved')}</Banner> : null}
      {save.isError ? <Banner tone="danger">{errorText(save.error)}</Banner> : null}
    </ScrollScreen>
  );
}
