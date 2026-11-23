import { unwrap } from '@safezone/api-client';
import { colors, spacing, typography } from '@safezone/design-tokens';
import { type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  ChipGroup,
  ConfirmModal,
  ListRow,
  ScreenHeader,
  ScrollScreen,
  Segmented,
  TextField,
  ToggleRow,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import { announcementErrors, broadcastErrors } from '../../src/features/announcement-form';
import { errorText } from '../../src/lib/errors';
import { useManager } from '../../src/lib/manager';
import { api } from '../../src/lib/session';

const CATEGORIES = ['general', 'security', 'maintenance', 'event', 'billing'] as const;
type Category = (typeof CATEGORIES)[number];

/**
 * Compose an announcement to the whole estate or specific buildings/spaces, or, with
 * `broadcast.emergency`, an emergency broadcast by push and SMS to every member after a confirmation.
 */
export default function NewAnnouncementScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { estateId, can, hasFeature } = useManager();
  const canBroadcast = hasFeature('emergency') && can('broadcast.emergency');
  const [emergency, setEmergency] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<Category>('general');
  const [priority, setPriority] = useState<'normal' | 'important'>('normal');
  const [audienceType, setAudienceType] = useState<'estate' | 'spaces'>('estate');
  const [selectedSpaces, setSelectedSpaces] = useState<string[]>([]);
  const [errors, setErrors] = useState<{ title?: string; body?: string; spaces?: string }>({});
  const [confirming, setConfirming] = useState(false);

  const spaces = useQuery({
    queryKey: ['estate', estateId, 'spaces'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/spaces', { params: { path: { estateId } } })),
    enabled: !emergency && audienceType === 'spaces',
    staleTime: 5 * 60_000,
  });

  const toggleSpace = (id: string) => {
    setSelectedSpaces((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'announcements'] });
    router.back();
  };
  const publish = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/announcements', {
          params: { path: { estateId } },
          body: {
            title: title.trim(),
            body: body.trim(),
            category,
            priority,
            audience:
              audienceType === 'spaces'
                ? { type: 'spaces', spaceIds: selectedSpaces }
                : { type: 'estate' },
          },
        }),
      ),
    onSuccess: done,
  });
  const broadcast = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/emergency-broadcasts', {
          params: { path: { estateId } },
          body: { title: title.trim(), body: body.trim(), confirm: true },
        }),
      ),
    onSuccess: () => {
      setConfirming(false);
      done();
    },
  });

  const submit = () => {
    const found = emergency
      ? broadcastErrors({ title, body })
      : announcementErrors({ title, body });
    const spacesError =
      !emergency && audienceType === 'spaces' && selectedSpaces.length === 0
        ? t('mm.announcements.spacesRequired')
        : undefined;
    const text = {
      title: found.title ? t(found.title as MessageKey) : undefined,
      body: found.body ? t(found.body as MessageKey) : undefined,
      spaces: spacesError,
    };
    setErrors(text);
    if (text.title || text.body || text.spaces) return;
    if (emergency) setConfirming(true);
    else publish.mutate();
  };

  const mutation = emergency ? broadcast : publish;

  return (
    <ScrollScreen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        <ActionButton
          label={
            emergency ? t('mm.announcements.sendBroadcast') : t('announcement.compose.publish')
          }
          variant={emergency ? 'danger' : 'primary'}
          busy={mutation.isPending}
          onPress={submit}
        />
      }
    >
      <ScreenHeader
        title={t('announcement.compose.title')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      {canBroadcast ? (
        <ToggleRow
          label={t('mm.announcements.emergency')}
          helper={t('mm.announcements.emergencyHelp')}
          value={emergency}
          onChange={setEmergency}
        />
      ) : null}
      {emergency ? <Banner tone="danger">{t('mm.announcements.emergencyWarning')}</Banner> : null}
      <TextField
        label={t('announcement.form.title')}
        value={title}
        onChangeText={setTitle}
        maxLength={emergency ? 80 : 120}
        error={errors.title}
        autoCapitalize="sentences"
      />
      <TextField
        label={t('announcement.form.body')}
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={emergency ? 320 : 4000}
        error={errors.body}
        helper={emergency ? t('mm.announcements.smsLength') : undefined}
        autoCapitalize="sentences"
      />
      {!emergency ? (
        <>
          <ChipGroup
            label={t('announcement.form.category')}
            options={CATEGORIES.map((key) => ({
              key,
              label: t(`announcement.category.${key}` as MessageKey),
            }))}
            value={category}
            onChange={setCategory}
          />
          <Segmented
            label={t('announcement.form.priority')}
            value={priority}
            onChange={setPriority}
            options={[
              { key: 'normal', label: t('announcement.priority.normal') },
              { key: 'important', label: t('announcement.priority.important') },
            ]}
          />
          <Segmented
            label={t('mm.announcements.audience')}
            value={audienceType}
            onChange={setAudienceType}
            options={[
              { key: 'estate', label: t('mm.announcements.audience.estate') },
              { key: 'spaces', label: t('mm.announcements.audience.spaces') },
            ]}
          />
          {audienceType === 'spaces' ? (
            <View style={{ gap: spacing[2] }}>
              <Text style={{ fontSize: typography.size.sm, color: colors.semantic.textMuted }}>
                {t('mm.announcements.selectSpaces')}
              </Text>
              {errors.spaces ? <Banner tone="danger">{errors.spaces}</Banner> : null}
              {(spaces.data ?? [])
                .filter((space) => !space.archivedAt)
                .slice(0, 40)
                .map((space) => {
                  const picked = selectedSpaces.includes(space.id);
                  return (
                    <ListRow
                      key={space.id}
                      title={`${space.code}${space.name && space.name !== space.code ? ` · ${space.name}` : ''}`}
                      subtitle={space.type}
                      leading={
                        <Icon
                          name={picked ? 'checkbox' : 'square-outline'}
                          color={colors.brand.primary}
                          size={20}
                        />
                      }
                      onPress={() => toggleSpace(space.id)}
                    />
                  );
                })}
            </View>
          ) : (
            <Banner tone="neutral">{t('announcement.form.audienceEstate')}</Banner>
          )}
        </>
      ) : null}
      {mutation.isError && !confirming ? (
        <Banner tone="danger">{errorText(mutation.error)}</Banner>
      ) : null}

      <ConfirmModal
        visible={confirming}
        title={t('mm.announcements.confirmTitle')}
        body={t('mm.announcements.confirmBody')}
        confirmLabel={t('mm.announcements.sendBroadcast')}
        destructive
        busy={broadcast.isPending}
        error={broadcast.isError ? errorText(broadcast.error) : null}
        onConfirm={() => broadcast.mutate()}
        onCancel={() => {
          setConfirming(false);
          broadcast.reset();
        }}
      />
    </ScrollScreen>
  );
}
