import { unwrap, unwrapPage } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { formatDateTime, formatTime, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  ChipGroup,
  ConfirmModal,
  ScreenHeader,
  TextField,
  useSession,
} from '@safezone/mobile-ui';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../src/components/icon';
import {
  isMine,
  type Message,
  REACTIONS,
  reactionFor,
  REPORT_REASONS,
  type ReportReason,
} from '../../src/features/community';
import { useGuidelines } from '../../src/features/use-guidelines';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api, session } from '../../src/lib/session';

const REFRESH_MS = 5_000;

/** A channel conversation: newest at the bottom, long-press a message to react, reply, edit or report. */
export default function ChannelScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId } = useResident();
  const me = useSession(session).user?.id;
  const guidelines = useGuidelines();
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [selected, setSelected] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState<Message | null>(null);
  const [reporting, setReporting] = useState<Message | null>(null);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [reported, setReported] = useState(false);
  const [blocking, setBlocking] = useState<Message | null>(null);
  const [blocked, setBlocked] = useState(false);

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
  const channel = channels.data?.find((item) => item.id === id);
  const key = ['estate', estateId, 'channel', id, 'messages'];
  const messages = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/channels/{id}/messages', {
          params: { path: { estateId, id }, query: { limit: 30, cursor: pageParam } },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: REFRESH_MS,
  });
  const list = useMemo(
    () => messages.data?.pages.flatMap((page) => page.items) ?? [],
    [messages.data],
  );
  const byId = useMemo(() => new Map(list.map((message) => [message.id, message])), [list]);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });

  const send = useMutation({
    mutationFn: () =>
      editing
        ? unwrap(
            api.PATCH('/v1/estates/{estateId}/messages/{id}', {
              params: { path: { estateId, id: editing.id } },
              body: { body: text.trim() },
            }),
          )
        : unwrap(
            api.POST('/v1/estates/{estateId}/channels/{id}/messages', {
              params: { path: { estateId, id } },
              body: { body: text.trim(), ...(replyTo ? { replyToId: replyTo.id } : {}) },
            }),
          ),
    onSuccess: () => {
      setText('');
      setReplyTo(null);
      setEditing(null);
      refresh();
    },
  });
  const react = useMutation({
    mutationFn: ({ message, emoji }: { message: Message; emoji: string }) => {
      const mineAlready = message.reactions.some(
        (reaction) => reaction.emoji === emoji && reaction.mine,
      );
      return mineAlready
        ? unwrap(
            api.POST('/v1/estates/{estateId}/messages/{id}/reactions/remove', {
              params: { path: { estateId, id: message.id } },
              body: { emoji },
            }),
          )
        : unwrap(
            api.POST('/v1/estates/{estateId}/messages/{id}/reactions', {
              params: { path: { estateId, id: message.id } },
              body: { emoji },
            }),
          );
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (message: Message) =>
      unwrap(
        api.DELETE('/v1/estates/{estateId}/messages/{id}', {
          params: { path: { estateId, id: message.id } },
        }),
      ),
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
  });
  const report = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/reports', {
          params: { path: { estateId } },
          body: {
            targetType: 'message',
            targetId: reporting?.id ?? '',
            reason: reason ?? 'other',
            ...(details.trim() ? { details: details.trim() } : {}),
          },
        }),
      ),
    onSuccess: () => {
      setReporting(null);
      setReason(null);
      setDetails('');
      setReported(true);
    },
  });
  const join = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/channels/{id}/join', {
          params: { path: { estateId, id } },
        }),
      ),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'channels'] }),
  });
  const startDirect = useMutation({
    mutationFn: (userId: string) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/direct-channels', {
          params: { path: { estateId } },
          body: { userId },
        }),
      ),
    onSuccess: (dm) => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'channels'] });
      router.push(`/channel/${dm.id}`);
    },
  });
  const blockUser = useMutation({
    mutationFn: (userId: string) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/blocks', {
          params: { path: { estateId } },
          body: { userId },
        }),
      ),
    onSuccess: () => {
      setBlocking(null);
      setBlocked(true);
    },
  });

  const member = channel?.myStatus === 'active';
  const agreed = Boolean(guidelines.data?.acceptedAt);
  const staffOnly = Boolean(channel?.staffOnly);

  const renderMessage = ({ item }: { item: Message }) => {
    const own = isMine(item, me);
    const quoted = item.replyToId ? byId.get(item.replyToId) : undefined;
    const hidden = item.state !== 'visible';
    return (
      <Pressable
        onLongPress={hidden ? undefined : () => setSelected(item)}
        delayLongPress={300}
        accessibilityHint={hidden ? undefined : t('res.chat.longPressHint')}
        style={[styles.bubble, own ? styles.mine : styles.theirs]}
      >
        {!own ? (
          <Text style={styles.author}>{item.authorName ?? t('res.chat.someone')}</Text>
        ) : null}
        {quoted ? (
          <View style={styles.quote}>
            <Text numberOfLines={2} style={styles.quoteText}>
              {quoted.authorName ?? t('res.chat.someone')}: {quoted.body ?? t('res.chat.deleted')}
            </Text>
          </View>
        ) : null}
        <Text style={[styles.body, hidden && styles.hidden]}>
          {item.state === 'deleted'
            ? t('res.chat.deleted')
            : item.state === 'removed'
              ? t('res.chat.removed')
              : item.body}
        </Text>
        <Text style={styles.time}>
          {formatTime(item.createdAt).slice(0, 5)}
          {item.editedAt ? ` · ${t('res.chat.edited')}` : ''}
        </Text>
        {item.reactions.length > 0 ? (
          <View style={styles.reactions}>
            {item.reactions.map((reaction) => {
              const known = reactionFor(reaction.emoji);
              return (
                <Pressable
                  key={reaction.emoji}
                  accessibilityRole="button"
                  accessibilityLabel={t('res.chat.reactionCount', {
                    reaction: t(`res.chat.reaction.${known?.key ?? 'other'}` as MessageKey),
                    count: reaction.count,
                  })}
                  onPress={() => react.mutate({ message: item, emoji: reaction.emoji })}
                  style={[styles.reactionChip, reaction.mine && styles.reactionMine]}
                >
                  {known ? (
                    <Icon
                      name={reaction.mine ? known.activeIcon : known.icon}
                      size={14}
                      color={colors.brand.primary}
                    />
                  ) : (
                    <Text style={styles.reactionText}>{reaction.emoji}</Text>
                  )}
                  <Text style={styles.reactionText}>{reaction.count}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={{ flex: 1, backgroundColor: colors.semantic.background }}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={{ paddingHorizontal: spacing[4] }}>
          <ScreenHeader
            title={channel?.name ?? t('res.community.title')}
            subtitle={channel?.description ?? undefined}
            onBack={() => (router.canGoBack() ? router.back() : router.replace('/community'))}
            backIcon={<Icon name="arrow-back" />}
          />
        </View>
        {reported ? (
          <View style={{ paddingHorizontal: spacing[4] }}>
            <Banner tone="success">{t('res.chat.reported')}</Banner>
          </View>
        ) : null}
        {blocked ? (
          <View style={{ paddingHorizontal: spacing[4] }}>
            <Banner tone="info">{t('res.chat.blocked')}</Banner>
          </View>
        ) : null}
        {startDirect.isError ? (
          <View style={{ paddingHorizontal: spacing[4] }}>
            <Banner tone="danger">{errorText(startDirect.error)}</Banner>
          </View>
        ) : null}
        <FlatList
          inverted
          data={list}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={{ padding: spacing[4], gap: spacing[2] }}
          onEndReached={() => {
            if (messages.hasNextPage && !messages.isFetchingNextPage) void messages.fetchNextPage();
          }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            messages.isFetchingNextPage ? (
              <ActivityIndicator color={colors.brand.primary} />
            ) : undefined
          }
          ListEmptyComponent={
            messages.isPending ? (
              <ActivityIndicator color={colors.brand.primary} />
            ) : messages.isError ? (
              <Text style={styles.empty}>{errorText(messages.error)}</Text>
            ) : (
              <Text style={styles.empty}>{t('res.chat.empty')}</Text>
            )
          }
        />
        <View style={styles.composer}>
          {!member && channel ? (
            <ActionButton
              label={
                channel.privacy === 'public' ? t('res.community.join') : t('res.community.ask')
              }
              onPress={() => join.mutate()}
              busy={join.isPending}
            />
          ) : !agreed ? (
            <ActionButton
              label={t('res.chat.readGuidelines')}
              variant="outline"
              onPress={() => router.push('/community/guidelines')}
            />
          ) : staffOnly ? (
            <Text style={styles.note}>{t('res.chat.staffOnly')}</Text>
          ) : (
            <>
              {replyTo || editing ? (
                <View style={styles.replyBar}>
                  <Text numberOfLines={1} style={[styles.note, { flex: 1 }]}>
                    {editing
                      ? t('res.chat.editing')
                      : t('res.chat.replyingTo', {
                          name: replyTo?.authorName ?? t('res.chat.someone'),
                        })}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('common.cancel')}
                    onPress={() => {
                      setReplyTo(null);
                      if (editing) setText('');
                      setEditing(null);
                    }}
                    style={styles.iconButton}
                  >
                    <Icon name="close" size={18} color={colors.semantic.textMuted} />
                  </Pressable>
                </View>
              ) : null}
              <View style={styles.inputRow}>
                <TextInput
                  accessibilityLabel={t('res.chat.placeholder')}
                  placeholder={t('res.chat.placeholder')}
                  placeholderTextColor={colors.semantic.textMuted}
                  value={text}
                  onChangeText={setText}
                  multiline
                  maxLength={4000}
                  style={styles.input}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('res.chat.send')}
                  disabled={!text.trim() || send.isPending}
                  onPress={() => send.mutate()}
                  style={[styles.send, (!text.trim() || send.isPending) && { opacity: 0.5 }]}
                >
                  {send.isPending ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Icon name="send" color="#FFFFFF" size={20} />
                  )}
                </Pressable>
              </View>
              {send.isError ? (
                <Text style={{ color: colors.status.danger, fontSize: typography.size.sm }}>
                  {errorText(send.error)}
                </Text>
              ) : null}
            </>
          )}
          {join.isError ? (
            <Text style={{ color: colors.status.danger, fontSize: typography.size.sm }}>
              {errorText(join.error)}
            </Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>

      {/* Message actions */}
      <Modal
        visible={Boolean(selected)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}
      >
        <Pressable
          style={styles.scrim}
          onPress={() => setSelected(null)}
          accessibilityLabel={t('ui.close')}
        >
          <Pressable style={styles.sheet}>
            <Text numberOfLines={2} style={styles.note}>
              {selected?.authorName ?? t('res.chat.someone')} ·{' '}
              {selected ? formatDateTime(selected.createdAt) : ''}
            </Text>
            {member && agreed ? (
              <View style={styles.reactionPicker}>
                {REACTIONS.map((reaction) => (
                  <Pressable
                    key={reaction.key}
                    accessibilityRole="button"
                    accessibilityLabel={t(`res.chat.reaction.${reaction.key}` as MessageKey)}
                    onPress={() => {
                      if (selected) react.mutate({ message: selected, emoji: reaction.key });
                      setSelected(null);
                    }}
                    style={styles.reactionPick}
                  >
                    <Icon name={reaction.icon} size={24} color={colors.brand.primary} />
                  </Pressable>
                ))}
              </View>
            ) : null}
            {member && agreed && !staffOnly ? (
              <ActionButton
                label={t('res.chat.reply')}
                variant="outline"
                onPress={() => {
                  setReplyTo(selected);
                  setEditing(null);
                  setSelected(null);
                }}
              />
            ) : null}
            {selected && isMine(selected, me) ? (
              <>
                <ActionButton
                  label={t('common.edit')}
                  variant="outline"
                  onPress={() => {
                    setEditing(selected);
                    setReplyTo(null);
                    setText(selected.body ?? '');
                    setSelected(null);
                  }}
                />
                <ActionButton
                  label={t('res.chat.delete')}
                  variant="text"
                  onPress={() => {
                    setDeleting(selected);
                    setSelected(null);
                  }}
                />
              </>
            ) : (
              <>
                {selected &&
                channel?.type !== 'direct' &&
                settings.data?.['community.private_messaging'] ? (
                  <ActionButton
                    label={t('res.chat.messagePrivately')}
                    variant="outline"
                    busy={startDirect.isPending}
                    onPress={() => {
                      const authorId = selected.authorId;
                      setSelected(null);
                      startDirect.mutate(authorId);
                    }}
                  />
                ) : null}
                <ActionButton
                  label={t('res.chat.report')}
                  variant="text"
                  onPress={() => {
                    setReporting(selected);
                    setSelected(null);
                  }}
                />
                {selected ? (
                  <ActionButton
                    label={t('res.chat.blockUser')}
                    variant="text"
                    onPress={() => {
                      setBlocking(selected);
                      setSelected(null);
                    }}
                  />
                ) : null}
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Report a message */}
      <Modal
        visible={Boolean(reporting)}
        transparent
        animationType="fade"
        onRequestClose={() => setReporting(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.scrim}
        >
          <View style={styles.sheet}>
            <Text
              style={{
                fontSize: typography.size.lg,
                fontWeight: '700',
                color: colors.semantic.text,
              }}
            >
              {t('res.chat.reportTitle')}
            </Text>
            <Text style={styles.note}>{t('res.chat.reportBody')}</Text>
            <ChipGroup<ReportReason>
              label={t('res.chat.reportReason')}
              value={reason}
              onChange={setReason}
              options={REPORT_REASONS.map((key) => ({
                key,
                label: t(`res.chat.reportReason.${key}` as MessageKey),
              }))}
            />
            <TextField
              label={t('res.chat.reportDetails')}
              value={details}
              onChangeText={setDetails}
              multiline
              maxLength={1000}
            />
            {report.isError ? (
              <Text style={{ color: colors.status.danger }}>{errorText(report.error)}</Text>
            ) : null}
            <ActionButton
              label={t('res.chat.sendReport')}
              variant="danger"
              disabled={!reason}
              busy={report.isPending}
              onPress={() => report.mutate()}
            />
            <ActionButton
              label={t('common.cancel')}
              variant="text"
              onPress={() => setReporting(null)}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ConfirmModal
        visible={Boolean(deleting)}
        title={t('res.chat.deleteTitle')}
        body={t('res.chat.deleteBody')}
        confirmLabel={t('res.chat.delete')}
        cancelLabel={t('res.chat.keep')}
        destructive
        busy={remove.isPending}
        error={remove.isError ? errorText(remove.error) : null}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      />

      <ConfirmModal
        visible={Boolean(blocking)}
        title={t('res.chat.blockTitle', { name: blocking?.authorName ?? t('res.chat.someone') })}
        body={t('res.chat.blockBody')}
        confirmLabel={t('res.chat.blockConfirm')}
        cancelLabel={t('common.cancel')}
        destructive
        busy={blockUser.isPending}
        error={blockUser.isError ? errorText(blockUser.error) : null}
        onConfirm={() => blocking && blockUser.mutate(blocking.authorId)}
        onCancel={() => setBlocking(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '85%', borderRadius: radii.lg, padding: spacing[3], gap: 4 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.brand.primarySubtle },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.semantic.surface,
    borderWidth: 1,
    borderColor: colors.semantic.borderSubtle,
  },
  author: { fontSize: typography.size.xs, fontWeight: '700', color: colors.brand.primary },
  body: { fontSize: typography.size.md, color: colors.semantic.text, lineHeight: 22 },
  hidden: { fontStyle: 'italic', color: colors.semantic.textMuted },
  time: { fontSize: 11, color: colors.semantic.textMuted, alignSelf: 'flex-end' },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.brand.primary, paddingLeft: 8 },
  quoteText: { fontSize: typography.size.sm, color: colors.semantic.textMuted },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    minHeight: 28,
    backgroundColor: colors.semantic.surfaceMuted,
  },
  reactionMine: { borderWidth: 1, borderColor: colors.brand.primary },
  reactionText: { fontSize: typography.size.xs, color: colors.semantic.text },
  empty: { textAlign: 'center', color: colors.semantic.textMuted, padding: spacing[5] },
  composer: {
    padding: spacing[3],
    gap: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colors.semantic.borderSubtle,
    backgroundColor: colors.semantic.surface,
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing[2] },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: colors.semantic.borderStrong,
    borderRadius: radii.lg,
    paddingHorizontal: spacing[3],
    paddingTop: 12,
    fontSize: typography.size.md,
    color: colors.semantic.text,
  },
  send: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyBar: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  iconButton: { minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  note: { fontSize: typography.size.sm, color: colors.semantic.textMuted },
  scrim: { flex: 1, backgroundColor: colors.overlay.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.semantic.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing[5],
    gap: spacing[3],
  },
  reactionPicker: { flexDirection: 'row', justifyContent: 'space-around' },
  reactionPick: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.primarySubtle,
  },
});
