import { unwrap } from '@safezone/api-client';
import { colors, palette, radii, typography } from '@safezone/design-tokens';
import { formatDateTime, t } from '@safezone/i18n';
import { Card, StatusPill } from '@safezone/mobile-ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { errorText } from '../lib/errors';
import { useResident } from '../lib/resident';
import { api } from '../lib/session';
import { type Poll, pollShares } from './community';

/** A poll: vote once while it is open, then see the results (or "results when it closes"). */
export function PollCard({ poll }: { poll: Poll }) {
  const queryClient = useQueryClient();
  const { estateId } = useResident();
  const vote = useMutation({
    mutationFn: (optionId: string) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/polls/{id}/votes', {
          params: { path: { estateId, id: poll.id } },
          body: { optionId },
        }),
      ),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'polls'] }),
  });
  const open = poll.status === 'open';
  const voted = Boolean(poll.myVoteOptionId);
  const showResults = voted || !open;
  const countsHidden = poll.options.every((option) => option.votes === null);
  const shares = pollShares(poll);

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text
          style={{
            flex: 1,
            fontSize: typography.size.md,
            fontWeight: '600',
            color: colors.semantic.text,
          }}
        >
          {poll.question}
        </Text>
        <StatusPill
          tone={open ? 'info' : 'neutral'}
          label={open ? t('res.poll.open') : t('res.poll.closed')}
        />
      </View>
      <Text style={{ fontSize: typography.size.xs, color: colors.semantic.textMuted }}>
        {open
          ? t('res.poll.closes', { date: formatDateTime(poll.closesAt) })
          : t('res.poll.closedOn', { date: formatDateTime(poll.closesAt) })}
        {poll.votePer === 'household' ? ` · ${t('res.poll.perHousehold')}` : ''}
        {poll.anonymous ? ` · ${t('res.poll.anonymous')}` : ''}
      </Text>
      {shares.map((share) => {
        const mine = poll.myVoteOptionId === share.id;
        if (!showResults) {
          return (
            <Pressable
              key={share.id}
              accessibilityRole="button"
              accessibilityLabel={t('res.poll.voteFor', { option: share.label })}
              disabled={vote.isPending}
              onPress={() => vote.mutate(share.id)}
              style={({ pressed }) => ({
                minHeight: 48,
                borderRadius: radii.md,
                borderWidth: 1,
                borderColor: colors.semantic.borderStrong,
                paddingHorizontal: 12,
                justifyContent: 'center',
                backgroundColor: pressed ? colors.brand.primarySubtle : colors.semantic.surface,
              })}
            >
              {vote.isPending && vote.variables === share.id ? (
                <ActivityIndicator color={colors.brand.primary} />
              ) : (
                <Text style={{ fontSize: typography.size.md, color: colors.semantic.text }}>
                  {share.label}
                </Text>
              )}
            </Pressable>
          );
        }
        return (
          <View
            key={share.id}
            accessible
            accessibilityLabel={countsHidden ? share.label : `${share.label}, ${share.percent}%`}
            style={{ gap: 4 }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text
                style={{
                  flex: 1,
                  fontSize: typography.size.sm,
                  color: colors.semantic.text,
                  fontWeight: mine ? '700' : '400',
                }}
              >
                {share.label}
                {mine ? ` (${t('res.poll.yourVote')})` : ''}
              </Text>
              {countsHidden ? null : (
                <Text
                  style={{
                    fontSize: typography.size.sm,
                    color: colors.semantic.text,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {share.percent}%
                </Text>
              )}
            </View>
            {countsHidden ? null : (
              <View
                style={{
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: colors.semantic.surfaceMuted,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    width: `${share.percent}%`,
                    height: 8,
                    backgroundColor: mine ? colors.brand.primary : palette.forest[300],
                  }}
                />
              </View>
            )}
          </View>
        );
      })}
      {showResults ? (
        <Text style={{ fontSize: typography.size.xs, color: colors.semantic.textMuted }}>
          {countsHidden
            ? t('res.poll.resultsLater')
            : t('res.poll.total', { count: poll.totalVotes ?? 0 })}
        </Text>
      ) : null}
      {vote.isError ? (
        <Text style={{ color: colors.status.danger, fontSize: typography.size.sm }}>
          {errorText(vote.error)}
        </Text>
      ) : null}
    </Card>
  );
}
