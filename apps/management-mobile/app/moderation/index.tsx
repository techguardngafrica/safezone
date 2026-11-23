import { unwrap } from '@safezone/api-client';
import { colors, spacing, typography } from '@safezone/design-tokens';
import { type MessageKey, formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ChipGroup,
  ConfirmModal,
  EmptyState,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
  StatusPill,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import {
  MUTE_DURATIONS,
  type ModerationActionKind,
  type ModerationTargetType,
  isDestructiveModeration,
  moderationActionsFor,
  moderationInputValid,
} from '../../src/features/moderation-rules';
import { errorText, isNetworkError } from '../../src/lib/errors';
import { useManager } from '../../src/lib/manager';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

/** Community moderation queue (management-mobile.md §7.7). Every action writes a moderation audit entry. */
export default function ModerationQueueScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { estateId, can, hasFeature } = useManager();
  const allowed = hasFeature('community') && can('community.moderate');

  const queue = useQuery({
    queryKey: ['estate', estateId, 'moderation', 'queue'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/moderation/queue', {
          params: { path: { estateId }, query: { status: 'open' } },
        }),
      ),
    enabled: allowed,
  });
  const pull = usePullRefresh(queue.refetch);

  const [pending, setPending] = useState<{
    reportId: string;
    targetType: ModerationTargetType;
    targetId: string;
    action: ModerationActionKind;
  } | null>(null);
  const [reason, setReason] = useState('');
  const [durationHours, setDurationHours] = useState<number>(24);

  const act = useMutation({
    mutationFn: () => {
      if (!pending) throw new Error('No pending moderation action');
      return unwrap(
        api.POST('/v1/estates/{estateId}/moderation/actions', {
          params: { path: { estateId } },
          body: {
            action: pending.action,
            targetType: pending.targetType,
            targetId: pending.targetId,
            reportId: pending.reportId,
            reason: reason.trim(),
            ...(pending.action === 'mute' ? { durationHours } : {}),
          },
        }),
      );
    },
    onSuccess: () => {
      setPending(null);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'moderation'] });
    },
  });

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={t('mm.moderation.title')}
        subtitle={t('mm.moderation.subtitle')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      {queue.isPending ? (
        <>
          <Skeleton height={120} />
          <Skeleton height={120} />
        </>
      ) : null}
      {queue.isError ? (
        isNetworkError(queue.error) ? (
          <Banner tone="warning">{t('mm.offline.actions')}</Banner>
        ) : (
          <ErrorState message={errorText(queue.error)} onRetry={() => void queue.refetch()} />
        )
      ) : null}
      {queue.data && queue.data.length === 0 ? (
        <EmptyState
          icon={<Icon name="shield-checkmark-outline" size={28} color={colors.brand.primary} />}
          title={t('mm.moderation.empty')}
          body={t('mm.moderation.emptyBody')}
        />
      ) : null}
      {(queue.data ?? []).map((item) => {
        const actions = moderationActionsFor(item.targetType);
        return (
          <Card key={item.id}>
            <View style={{ gap: spacing[2] }}>
              <View
                style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing[2] }}
              >
                <StatusPill
                  tone="warning"
                  label={t(`mm.moderation.target.${item.targetType}` as MessageKey)}
                />
                <Text style={{ fontSize: typography.size.sm, color: colors.semantic.textMuted }}>
                  {formatDateTime(item.createdAt)}
                </Text>
              </View>
              <Text
                style={{
                  fontSize: typography.size.md,
                  fontWeight: typography.weight.semibold,
                  color: colors.semantic.text,
                }}
              >
                {item.reason}
              </Text>
              {item.preview ? (
                <Text style={{ fontSize: typography.size.md, color: colors.semantic.text }}>
                  “{item.preview}”
                </Text>
              ) : null}
              {item.details ? (
                <Text style={{ fontSize: typography.size.sm, color: colors.semantic.textMuted }}>
                  {item.details}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] }}>
                {actions.map((actionKind) => (
                  <ActionButton
                    key={actionKind}
                    label={t(`mm.moderation.action.${actionKind}` as MessageKey)}
                    variant={actionKind === 'dismiss_report' ? 'outline' : 'primary'}
                    onPress={() => {
                      setReason('');
                      setDurationHours(24);
                      setPending({
                        reportId: item.id,
                        targetType: item.targetType,
                        targetId: item.targetId,
                        action: actionKind,
                      });
                    }}
                  />
                ))}
              </View>
            </View>
          </Card>
        );
      })}

      {pending?.action === 'mute' ? (
        <Card>
          <ChipGroup
            label={t('mm.moderation.muteDuration')}
            options={MUTE_DURATIONS.map((h) => ({
              key: String(h),
              label: t('mm.moderation.hours', { count: h }),
            }))}
            value={String(durationHours)}
            onChange={(val) => setDurationHours(Number(val))}
          />
        </Card>
      ) : null}

      <ConfirmModal
        visible={pending !== null}
        title={pending ? t(`mm.moderation.action.${pending.action}` as MessageKey) : ''}
        body={pending ? t(`mm.moderation.confirm.${pending.action}` as MessageKey) : ''}
        confirmLabel={pending ? t(`mm.moderation.action.${pending.action}` as MessageKey) : ''}
        destructive={pending ? isDestructiveModeration(pending.action) : false}
        busy={act.isPending}
        error={act.isError ? errorText(act.error) : null}
        reason={{
          label: t('mm.moderation.reasonLabel'),
          value: reason,
          onChange: setReason,
          required: true,
        }}
        onConfirm={() => {
          if (!pending) return;
          if (!moderationInputValid(pending.action, reason, durationHours)) return;
          act.mutate();
        }}
        onCancel={() => {
          setPending(null);
          act.reset();
        }}
      />
    </ScrollScreen>
  );
}
