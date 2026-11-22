import { unwrap } from '@safezone/api-client';
import { colors, typography } from '@safezone/design-tokens';
import { type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  ScreenHeader,
  ScrollScreen,
  Segmented,
  Skeleton,
  StatusPill,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Icon } from '../../src/components/icon';
import { SOS_CLEARANCE } from '../../src/components/sos-button';
import type { Channel } from '../../src/features/community';
import { useGuidelines } from '../../src/features/use-guidelines';
import { PollCard } from '../../src/features/poll-card';
import { SponsoredSlot } from '../../src/features/sponsored-slot';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

function channelSubtitle(channel: Channel): string {
  const parts = [t(`res.community.type.${channel.type}` as MessageKey)];
  if (channel.memberCount !== null)
    parts.push(t('res.community.members', { count: channel.memberCount }));
  if (channel.staffOnly) parts.push(t('res.community.staffPosts'));
  return parts.join(' · ');
}

/** Community (UI_GUIDELINES §8.1): estate and building channels, resident groups, and polls. */
export default function CommunityScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { estateId, can } = useResident();
  const [view, setView] = useState<'groups' | 'messages' | 'polls'>('groups');
  const guidelines = useGuidelines();
  const settings = useQuery({
    queryKey: ['estate', estateId, 'settings'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/settings', { params: { path: { estateId } } })),
  });
  const channels = useQuery({
    queryKey: ['estate', estateId, 'channels'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/channels', { params: { path: { estateId } } })),
  });
  const polls = useQuery({
    queryKey: ['estate', estateId, 'polls'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/polls', { params: { path: { estateId } } })),
  });
  const pull = usePullRefresh(() =>
    Promise.all([channels.refetch(), polls.refetch(), guidelines.refetch(), settings.refetch()]),
  );
  const join = useMutation({
    mutationFn: (channel: Channel) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/channels/{id}/join', {
          params: { path: { estateId, id: channel.id } },
        }),
      ),
    onSuccess: (channel) => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'channels'] });
      if (channel.myStatus === 'active') router.push(`/channel/${channel.id}`);
    },
  });

  const all = (channels.data ?? []).filter(
    (channel) => channel.type !== 'direct' && channel.status !== 'archived',
  );
  const direct = (channels.data ?? []).filter(
    (channel) => channel.type === 'direct' && channel.status !== 'archived',
  );
  const showMessages = Boolean(settings.data?.['community.private_messaging']) || direct.length > 0;
  const mine = all.filter((channel) => channel.myStatus === 'active');
  const others = all.filter((channel) => channel.myStatus !== 'active');
  const openPolls = (polls.data ?? []).filter((poll) => poll.status === 'open');
  const closedPolls = (polls.data ?? []).filter((poll) => poll.status !== 'open');

  return (
    <ScrollScreen bottomInset={SOS_CLEARANCE} {...pull}>
      <ScreenHeader title={t('res.community.title')} />
      {guidelines.data && !guidelines.data.acceptedAt ? (
        <Card
          onPress={() => router.push('/community/guidelines')}
          accessibilityLabel={t('res.community.guidelinesPrompt')}
        >
          <Text style={{ fontWeight: '600', color: colors.semantic.text }}>
            {t('res.community.guidelinesTitle')}
          </Text>
          <Text style={{ color: colors.semantic.textMuted, fontSize: typography.size.sm }}>
            {t('res.community.guidelinesPrompt')}
          </Text>
        </Card>
      ) : null}
      <Segmented<'groups' | 'messages' | 'polls'>
        label={t('res.community.title')}
        value={view}
        onChange={setView}
        options={[
          { key: 'groups', label: t('res.community.groups') },
          ...(showMessages
            ? [{ key: 'messages' as const, label: t('res.community.messages') }]
            : []),
          {
            key: 'polls',
            label:
              openPolls.length > 0
                ? t('res.community.pollsCount', { count: openPolls.length })
                : t('res.community.polls'),
          },
        ]}
      />
      {view === 'groups' ? (
        <>
          {channels.isPending ? <Skeleton height={120} /> : null}
          {channels.isError ? (
            <ErrorState
              message={errorText(channels.error)}
              onRetry={() => void channels.refetch()}
            />
          ) : null}
          {mine.length > 0 ? (
            <Card>
              {mine.map((channel) => (
                <ListRow
                  key={channel.id}
                  title={channel.name}
                  subtitle={channelSubtitle(channel)}
                  leading={
                    <Icon
                      name={channel.type === 'resident' ? 'people-outline' : 'chatbubbles-outline'}
                      color={colors.brand.primary}
                      size={20}
                    />
                  }
                  trailing={
                    channel.status === 'pending_approval' ? (
                      <StatusPill tone="info" label={t('res.community.awaitingApproval')} />
                    ) : (
                      <Icon name="chevron-forward" size={18} color={colors.semantic.textMuted} />
                    )
                  }
                  onPress={() => router.push(`/channel/${channel.id}`)}
                />
              ))}
            </Card>
          ) : null}
          {others.length > 0 ? (
            <>
              <Text
                style={{
                  color: colors.semantic.textMuted,
                  fontSize: typography.size.sm,
                  fontWeight: '600',
                }}
              >
                {t('res.community.discover')}
              </Text>
              <Card>
                {others.map((channel) => (
                  <ListRow
                    key={channel.id}
                    title={channel.name}
                    subtitle={channel.description ?? channelSubtitle(channel)}
                    leading={<Icon name="people-outline" color={colors.brand.primary} size={20} />}
                    trailing={
                      channel.status === 'pending_approval' ? (
                        <StatusPill tone="info" label={t('res.community.awaitingApproval')} />
                      ) : channel.myStatus === 'requested' ? (
                        <StatusPill tone="neutral" label={t('res.community.requested')} />
                      ) : (
                        <ActionButton
                          label={
                            channel.privacy === 'public'
                              ? t('res.community.join')
                              : t('res.community.ask')
                          }
                          variant="outline"
                          busy={join.isPending && join.variables?.id === channel.id}
                          onPress={() => join.mutate(channel)}
                        />
                      )
                    }
                  />
                ))}
              </Card>
            </>
          ) : null}
          {/* Channels list only: never in private messages (AGENTS.md §6.2). */}
          <SponsoredSlot placement="resident.feed.sponsored" context="community_feed" />
          {join.isError ? <Banner tone="danger">{errorText(join.error)}</Banner> : null}
          {channels.data && all.length === 0 ? (
            <EmptyState
              icon={<Icon name="chatbubbles-outline" size={28} color={colors.brand.primary} />}
              title={t('res.community.empty')}
            />
          ) : null}
          {can('community.channel.create') ? (
            <ActionButton
              label={t('res.community.newGroup')}
              variant="outline"
              icon={<Icon name="add" color={colors.brand.primary} size={20} />}
              onPress={() => router.push('/channel/new')}
            />
          ) : null}
        </>
      ) : view === 'messages' ? (
        <>
          {channels.isPending ? <Skeleton height={120} /> : null}
          {channels.isError ? (
            <ErrorState
              message={errorText(channels.error)}
              onRetry={() => void channels.refetch()}
            />
          ) : null}
          {channels.data && direct.length === 0 ? (
            <EmptyState
              icon={<Icon name="mail-outline" size={28} color={colors.brand.primary} />}
              title={t('res.community.messagesEmpty')}
              body={t('res.community.messagesEmptyBody')}
            />
          ) : null}
          {direct.length > 0 ? (
            <Card>
              {direct.map((channel) => (
                <ListRow
                  key={channel.id}
                  title={channel.name}
                  subtitle={t('res.community.type.direct')}
                  leading={<Icon name="person-outline" color={colors.brand.primary} size={20} />}
                  trailing={
                    <Icon name="chevron-forward" size={18} color={colors.semantic.textMuted} />
                  }
                  onPress={() => router.push(`/channel/${channel.id}`)}
                />
              ))}
            </Card>
          ) : null}
        </>
      ) : (
        <>
          {polls.isPending ? <Skeleton height={160} /> : null}
          {polls.isError ? (
            <ErrorState message={errorText(polls.error)} onRetry={() => void polls.refetch()} />
          ) : null}
          {polls.data && polls.data.length === 0 ? (
            <EmptyState
              icon={<Icon name="bar-chart-outline" size={28} color={colors.brand.primary} />}
              title={t('res.poll.empty')}
              body={t('res.poll.emptyBody')}
            />
          ) : null}
          {[...openPolls, ...closedPolls].map((poll) => (
            <PollCard key={poll.id} poll={poll} />
          ))}
        </>
      )}
    </ScrollScreen>
  );
}
