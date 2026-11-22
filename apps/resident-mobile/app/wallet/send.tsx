import { newIdempotencyKey, unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  ChipGroup,
  ScreenHeader,
  ScrollScreen,
  TextField,
} from '@safezone/mobile-ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking } from 'react-native';
import { Icon } from '../../src/components/icon';
import { Muted } from '../../src/features/market-text';
import { payFields, usePayChoice } from '../../src/features/pay-choice';
import {
  naira,
  rememberWalletItem,
  transferAmountOk,
  wholeNairaToKobo,
} from '../../src/features/wallet';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';

const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/**
 * Send money to a neighbour (ADR-0025). Recipients are found by unit and shown by first name only; the
 * money settles to their bank account through the payment provider.
 */
export default function SendMoneyScreen() {
  const router = useRouter();
  const { estateId } = useResident();
  const params = useLocalSearchParams<{
    recipientUserId?: string;
    firstName?: string;
    classifiedId?: string;
  }>();
  const key = useRef(newIdempotencyKey());
  const payChoice = usePayChoice();
  const [unit, setUnit] = useState('');
  const [search, setSearch] = useState('');
  const [recipient, setRecipient] = useState<string | null>(params.recipientUserId ?? null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ['estate', estateId, 'transfers', 'status'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/transfers/status', { params: { path: { estateId } } }),
      ),
  });
  const found = useQuery({
    queryKey: ['estate', estateId, 'transfers', 'recipients', search],
    enabled: search.length > 0,
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/transfers/recipients', {
          params: { path: { estateId }, query: { unit: search } },
        }),
      ),
  });
  const kobo = wholeNairaToKobo(amount);
  const send = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/transfers', {
          params: { path: { estateId } },
          headers: { 'Idempotency-Key': key.current },
          body: {
            recipientUserId: recipient ?? '',
            amountKobo: kobo ?? 0,
            ...(note.trim() ? { note: note.trim() } : {}),
            ...(params.classifiedId ? { classifiedId: params.classifiedId } : {}),
            ...(inExpoGo ? {} : { callbackUrl: 'safezone://wallet/return' }),
            ...payFields(payChoice.choice),
          },
        }),
      ),
    onSuccess: (transfer) => {
      key.current = newIdempotencyKey();
      rememberWalletItem({ kind: 'transfer', id: transfer.id });
      router.replace(`/wallet/transfer/${transfer.id}`);
      if (transfer.authorizationUrl) void Linking.openURL(transfer.authorizationUrl);
    },
    onError: () => {
      key.current = newIdempotencyKey();
    },
  });

  const recipientOptions = [
    ...(params.recipientUserId && params.firstName
      ? [{ key: params.recipientUserId, label: params.firstName }]
      : []),
    ...(found.data ?? []).map((r) => ({ key: r.userId, label: r.firstName })),
  ];

  if (status.data && !status.data.enabled)
    return (
      <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
        <ScreenHeader
          title={t('res.send.title')}
          onBack={() => router.back()}
          backIcon={<Icon name="arrow-back" />}
        />
        <Banner tone="info">{t('res.send.unavailable')}</Banner>
      </ScrollScreen>
    );

  return (
    <ScrollScreen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        <ActionButton
          label={t('res.send.submit', { amount: kobo ? naira(kobo) : '' })}
          busy={send.isPending}
          disabled={!recipient}
          onPress={() => {
            if (!transferAmountOk(kobo)) return setAmountError(t('res.send.amountInvalid'));
            setAmountError(null);
            send.mutate();
          }}
        />
      }
    >
      <ScreenHeader
        title={t('res.send.title')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      <Banner tone="info">{t('res.wallet.noBalance')}</Banner>
      {!params.recipientUserId ? (
        <>
          <TextField
            label={t('res.send.unit')}
            helper={t('res.send.unitHelper')}
            value={unit}
            onChangeText={setUnit}
            autoCapitalize="characters"
            maxLength={40}
          />
          <ActionButton
            label={t('res.send.find')}
            variant="outline"
            disabled={!unit.trim()}
            onPress={() => setSearch(unit.trim())}
          />
          {found.isError ? <Banner tone="danger">{errorText(found.error)}</Banner> : null}
          {found.data && found.data.length === 0 ? <Muted>{t('res.send.none')}</Muted> : null}
        </>
      ) : null}
      {recipientOptions.length > 0 ? (
        <ChipGroup
          label={t('res.send.to')}
          value={recipient}
          onChange={setRecipient}
          options={recipientOptions}
        />
      ) : null}
      <TextField
        label={t('res.send.amount')}
        helper={t('res.send.limits')}
        value={amount}
        onChangeText={setAmount}
        error={amountError}
        keyboardType="number-pad"
        maxLength={9}
      />
      <TextField label={t('res.send.note')} value={note} onChangeText={setNote} maxLength={140} />
      {payChoice.element}
      {send.isError ? <Banner tone="danger">{errorText(send.error)}</Banner> : null}
    </ScrollScreen>
  );
}
