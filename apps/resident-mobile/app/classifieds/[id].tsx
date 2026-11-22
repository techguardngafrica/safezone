import { unwrap } from '@safezone/api-client';
import { formatDate, formatDateTime, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  SectionHeader,
  Skeleton,
  StatusPill,
  TextField,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import { classifiedPriceText } from '../../src/features/marketplace';
import { Body, marketStyles, MessageLine, Muted, Row } from '../../src/features/market-text';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';

type Thread = {
  buyerUserId: string;
  buyerName: string | null;
  messages: { id: string; fromSeller: boolean; body: string; createdAt: string }[];
};

function ThreadView({
  thread,
  seller,
  onReply,
  busy,
}: {
  thread: Thread;
  seller: boolean;
  onReply?: (body: string) => void;
  busy?: boolean;
}) {
  const [body, setBody] = useState('');
  return (
    <Card>
      {seller ? (
        <Text style={marketStyles.label}>{thread.buyerName ?? t('res.classifieds.buyer')}</Text>
      ) : null}
      <View style={{ gap: 8 }}>
        {thread.messages.map((m) => (
          <MessageLine
            key={m.id}
            mine={m.fromSeller === seller}
            author={
              m.fromSeller === seller
                ? t('res.classifieds.you')
                : seller
                  ? t('res.classifieds.buyer')
                  : t('res.classifieds.seller.label')
            }
            when={formatDateTime(m.createdAt)}
            body={m.body}
          />
        ))}
      </View>
      {onReply ? (
        <>
          <TextField
            label={t('res.classifieds.reply')}
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={2000}
          />
          <ActionButton
            label={t('res.market.orders.send')}
            variant="outline"
            busy={busy}
            disabled={!body.trim()}
            onPress={() => {
              onReply(body.trim());
              setBody('');
            }}
          />
        </>
      ) : null}
    </Card>
  );
}

/** A neighbour's listing (ADR-0023). Only people in this estate see it; phone numbers are never shown. */
export default function ClassifiedScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { estateId } = useResident();
  const { id } = useLocalSearchParams<{ id: string }>();
  const path = { estateId, id };
  const key = ['estate', estateId, 'classified', id];
  const [ask, setAsk] = useState('');
  const item = useQuery({
    queryKey: key,
    queryFn: () => unwrap(api.GET('/v1/estates/{estateId}/classifieds/{id}', { params: { path } })),
  });
  const threads = useQuery({
    queryKey: [...key, 'threads'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/classifieds/{id}/messages', { params: { path } })),
    enabled: Boolean(item.data),
  });
  const post = useMutation({
    mutationFn: (input: { body: string; buyerUserId?: string }) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/classifieds/{id}/messages', {
          params: { path },
          body: input,
        }),
      ),
    onSuccess: (data) => {
      setAsk('');
      queryClient.setQueryData([...key, 'threads'], data);
    },
  });
  const update = useMutation({
    mutationFn: (status: 'active' | 'sold' | 'withdrawn') =>
      unwrap(
        api.PATCH('/v1/estates/{estateId}/classifieds/{id}', {
          params: { path },
          body: { status },
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'classifieds'] });
    },
  });
  const data = item.data;
  const mine = data?.mine ?? false;
  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        title={data?.title ?? t('res.market.tab.neighbours')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      {item.isPending ? <Skeleton height={160} /> : null}
      {item.isError ? (
        <ErrorState message={errorText(item.error)} onRetry={() => void item.refetch()} />
      ) : null}
      {data ? (
        <>
          <Card>
            <Row>
              <Text style={marketStyles.big}>{classifiedPriceText(data)}</Text>
              <StatusPill
                tone={data.status === 'active' ? 'success' : 'neutral'}
                label={t(`res.classifieds.status.${data.status}` as MessageKey)}
              />
            </Row>
            <Muted>
              {t(`res.classifieds.kind.${data.kind}` as MessageKey)}
              {data.condition
                ? ` · ${t(`res.classifieds.condition.${data.condition}` as MessageKey)}`
                : ''}
            </Muted>
            <Body>{data.description}</Body>
            <Muted>
              {t('res.classifieds.seller', {
                name: mine
                  ? t('res.classifieds.you')
                  : (data.seller.displayName ?? t('res.classifieds.neighbour')),
              })}
            </Muted>
            {mine ? (
              <Muted>{t('res.classifieds.expires', { date: formatDate(data.expiresAt) })}</Muted>
            ) : null}
          </Card>
          {data.hiddenReason ? (
            <Banner tone="warning">
              {t('res.classifieds.hiddenReason', { reason: data.hiddenReason })}
            </Banner>
          ) : null}
          <Banner tone="info">{t('res.classifieds.privacy')}</Banner>

          {mine && data.status !== 'hidden' ? (
            <View style={{ gap: 8 }}>
              {data.status === 'active' ? (
                <>
                  <ActionButton
                    label={t('res.classifieds.markSold')}
                    busy={update.isPending}
                    onPress={() => update.mutate('sold')}
                  />
                  <ActionButton
                    label={t('res.classifieds.withdraw')}
                    variant="outline"
                    busy={update.isPending}
                    onPress={() => update.mutate('withdrawn')}
                  />
                </>
              ) : (
                <ActionButton
                  label={t('res.classifieds.renew')}
                  variant="outline"
                  busy={update.isPending}
                  onPress={() => update.mutate('active')}
                />
              )}
              {update.isError ? <Banner tone="danger">{errorText(update.error)}</Banner> : null}
            </View>
          ) : null}

          <SectionHeader title={mine ? t('res.classifieds.enquiries') : t('res.classifieds.ask')} />
          {threads.isError ? <Banner tone="danger">{errorText(threads.error)}</Banner> : null}
          {mine && threads.data?.length === 0 ? (
            <Muted>{t('res.classifieds.noEnquiries')}</Muted>
          ) : null}
          {threads.data?.map((thread) => (
            <ThreadView
              key={thread.buyerUserId}
              thread={thread}
              seller={mine}
              busy={post.isPending}
              onReply={
                mine ? (body) => post.mutate({ body, buyerUserId: thread.buyerUserId }) : undefined
              }
            />
          ))}
          {!mine && data.status === 'active' ? (
            <>
              <TextField
                label={t('res.classifieds.askPlaceholder')}
                value={ask}
                onChangeText={setAsk}
                multiline
                maxLength={2000}
              />
              <ActionButton
                label={t('res.classifieds.ask')}
                busy={post.isPending}
                disabled={!ask.trim()}
                onPress={() => post.mutate({ body: ask.trim() })}
              />
            </>
          ) : null}
          {post.isError ? <Banner tone="danger">{errorText(post.error)}</Banner> : null}
        </>
      ) : null}
    </ScrollScreen>
  );
}
