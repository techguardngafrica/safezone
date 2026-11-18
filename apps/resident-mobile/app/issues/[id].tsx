import { unwrap } from '@safezone/api-client';
import { colors, spacing, typography } from '@safezone/design-tokens';
import { formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ChipGroup,
  ConfirmModal,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  SectionHeader,
  Skeleton,
  StatusPill,
  TextField,
  useSession,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import {
  CANCELLABLE,
  ISSUE_TONE,
  type IssueDetail,
  issueStatusLabel,
} from '../../src/features/issues';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api, session } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

type Action = 'comment' | 'respond' | 'cancel' | 'rate' | 'reopen';

export default function IssueScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId } = useResident();
  const me = useSession(session).user?.id;
  const [text, setText] = useState('');
  const [reply, setReply] = useState('');
  const [rating, setRating] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [confirm, setConfirm] = useState<'cancel' | 'reopen' | null>(null);
  const [reason, setReason] = useState('');

  const issue = useQuery({
    queryKey: ['estate', estateId, 'maintenance-request', id],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/maintenance-requests/{id}', {
          params: { path: { estateId, id } },
        }),
      ),
  });
  const pull = usePullRefresh(issue.refetch);

  const act = useMutation({
    mutationFn: (action: Action): Promise<IssueDetail> => {
      const path = { estateId, id };
      switch (action) {
        case 'comment':
          return unwrap(
            api.POST('/v1/estates/{estateId}/maintenance-requests/{id}/comments', {
              params: { path },
              body: { body: text.trim() },
            }),
          );
        case 'respond':
          return unwrap(
            api.POST('/v1/estates/{estateId}/maintenance-requests/{id}/respond', {
              params: { path },
              body: { note: reply.trim() },
            }),
          );
        case 'cancel':
          return unwrap(
            api.POST('/v1/estates/{estateId}/maintenance-requests/{id}/cancel', {
              params: { path },
              body: reason.trim() ? { note: reason.trim() } : {},
            }),
          );
        case 'rate':
          return unwrap(
            api.POST('/v1/estates/{estateId}/maintenance-requests/{id}/rate', {
              params: { path },
              body: {
                rating: Number(rating),
                ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
              },
            }),
          );
        default:
          return unwrap(
            api.POST('/v1/estates/{estateId}/maintenance-requests/{id}/reopen', {
              params: { path },
              body: { reason: reason.trim() },
            }),
          );
      }
    },
    onSuccess: (data, action) => {
      queryClient.setQueryData(['estate', estateId, 'maintenance-request', id], data);
      void queryClient.invalidateQueries({
        queryKey: ['estate', estateId, 'maintenance-requests'],
      });
      if (action === 'comment') setText('');
      if (action === 'respond') setReply('');
      setConfirm(null);
      setReason('');
    },
  });

  const data = issue.data;
  const closed = data ? ['closed', 'cancelled', 'rejected'].includes(data.status) : true;
  const comments = (data?.comments ?? []).filter((comment) => !comment.internal);

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={data?.title ?? t('res.issue.title')}
        subtitle={data ? `${data.number} · ${data.categoryName}` : undefined}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/issues'))}
        backIcon={<Icon name="arrow-back" />}
      />
      {issue.isPending ? <Skeleton height={160} /> : null}
      {issue.isError ? (
        <ErrorState message={errorText(issue.error)} onRetry={() => void issue.refetch()} />
      ) : null}
      {data ? (
        <>
          <StatusPill tone={ISSUE_TONE[data.status]} label={issueStatusLabel(data.status)} />
          {data.status === 'info_requested' ? (
            <Banner tone="warning">{t('res.issue.infoRequested')}</Banner>
          ) : null}
          {data.status === 'rejected' && data.rejectionReason ? (
            <Banner tone="danger">
              {t('res.issue.rejectedBecause', { reason: data.rejectionReason })}
            </Banner>
          ) : null}
          <Card>
            <Text style={styles.body}>{data.description}</Text>
            <Text style={styles.meta}>
              {t('res.issue.reportedOn', { date: formatDateTime(data.createdAt) })}
              {data.unitCode ? ` · ${data.unitCode}` : ''}
            </Text>
            {data.preferredTimes ? (
              <Text style={styles.meta}>
                {t('res.issue.preferredTimesValue', { times: data.preferredTimes })}
              </Text>
            ) : null}
          </Card>

          {data.status === 'info_requested' ? (
            <Card>
              <TextField
                label={t('res.issue.replyLabel')}
                value={reply}
                onChangeText={setReply}
                multiline
                maxLength={2000}
              />
              <ActionButton
                label={t('res.issue.sendReply')}
                onPress={() => act.mutate('respond')}
                busy={act.isPending && act.variables === 'respond'}
                disabled={reply.trim().length === 0}
              />
            </Card>
          ) : null}

          {data.status === 'resolved' && data.rating === null ? (
            <Card>
              <ChipGroup<string>
                label={t('res.issue.rateLabel')}
                value={rating}
                onChange={setRating}
                options={['1', '2', '3', '4', '5'].map((key) => ({
                  key,
                  label: t('res.issue.stars', { count: key }),
                }))}
              />
              <TextField
                label={t('res.issue.feedback')}
                value={feedback}
                onChangeText={setFeedback}
                multiline
                maxLength={1000}
              />
              <ActionButton
                label={t('res.issue.sendRating')}
                onPress={() => act.mutate('rate')}
                busy={act.isPending && act.variables === 'rate'}
                disabled={!rating}
              />
              <ActionButton
                label={t('res.issue.notFixed')}
                variant="text"
                onPress={() => setConfirm('reopen')}
              />
            </Card>
          ) : null}
          {data.rating !== null ? (
            <Text style={styles.meta}>{t('res.issue.youRated', { count: data.rating })}</Text>
          ) : null}

          <SectionHeader title={t('res.issue.updates')} />
          {comments.length === 0 ? (
            <Text style={styles.meta}>{t('res.issue.noUpdates')}</Text>
          ) : null}
          {comments.map((comment) => (
            <View
              key={comment.id}
              style={[styles.comment, comment.authorId === me ? styles.mine : null]}
            >
              <Text style={styles.commentAuthor}>
                {comment.authorId === me ? t('res.issue.you') : t('res.issue.estate')} ·{' '}
                {formatDateTime(comment.createdAt)}
              </Text>
              <Text style={styles.body}>{comment.body}</Text>
            </View>
          ))}
          {!closed ? (
            <Card>
              <TextField
                label={t('res.issue.addComment')}
                value={text}
                onChangeText={setText}
                multiline
                maxLength={2000}
              />
              <ActionButton
                label={t('res.issue.sendComment')}
                variant="outline"
                onPress={() => act.mutate('comment')}
                busy={act.isPending && act.variables === 'comment'}
                disabled={text.trim().length === 0}
              />
            </Card>
          ) : null}
          {act.isError && !confirm ? <Banner tone="danger">{errorText(act.error)}</Banner> : null}
          {CANCELLABLE.includes(data.status) ? (
            <ActionButton
              label={t('res.issue.cancel')}
              variant="text"
              onPress={() => setConfirm('cancel')}
            />
          ) : null}
          <ConfirmModal
            visible={confirm !== null}
            title={confirm === 'reopen' ? t('res.issue.reopenTitle') : t('res.issue.cancelTitle')}
            body={confirm === 'reopen' ? t('res.issue.reopenBody') : t('res.issue.cancelBody')}
            confirmLabel={confirm === 'reopen' ? t('res.issue.reopen') : t('res.issue.cancel')}
            cancelLabel={t('res.issue.keep')}
            destructive={confirm === 'cancel'}
            busy={act.isPending}
            error={act.isError ? errorText(act.error) : null}
            reason={{
              label:
                confirm === 'reopen' ? t('res.issue.reopenReason') : t('res.issue.cancelReason'),
              value: reason,
              onChange: setReason,
              required: confirm === 'reopen',
            }}
            onConfirm={() => confirm && act.mutate(confirm)}
            onCancel={() => {
              setConfirm(null);
              setReason('');
            }}
          />
        </>
      ) : null}
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: typography.size.md, color: colors.semantic.text, lineHeight: 22 },
  meta: { fontSize: typography.size.sm, color: colors.semantic.textMuted },
  comment: {
    backgroundColor: colors.semantic.surface,
    borderRadius: 12,
    padding: spacing[3],
    gap: 4,
    borderWidth: 1,
    borderColor: colors.semantic.borderSubtle,
  },
  mine: { backgroundColor: colors.brand.primarySubtle, borderColor: colors.brand.primarySubtle },
  commentAuthor: {
    fontSize: typography.size.xs,
    color: colors.semantic.textMuted,
    fontWeight: typography.weight.semibold,
  },
});
