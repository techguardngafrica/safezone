import { newIdempotencyKey, unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  ChipGroup,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
  TextField,
  useSession,
} from '@safezone/mobile-ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking } from 'react-native';
import { Icon } from '../../src/components/icon';
import { payFields, usePayChoice } from '../../src/features/pay-choice';
import {
  naira,
  NETWORK_LABELS,
  NETWORKS,
  type Network,
  rememberWalletItem,
  wholeNairaToKobo,
} from '../../src/features/wallet';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api, session } from '../../src/lib/session';

const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** Buy airtime or data (ADR-0025). Delivered only after the payment is verified; refunded in full if not. */
export default function BuyTopupScreen() {
  const router = useRouter();
  const { estateId } = useResident();
  const user = useSession(session).user;
  const { kind: rawKind } = useLocalSearchParams<{ kind?: string }>();
  const kind: 'airtime' | 'data' = rawKind === 'data' ? 'data' : 'airtime';
  const key = useRef(newIdempotencyKey());
  const payChoice = usePayChoice();
  const [network, setNetwork] = useState<Network>('mtn');
  const [phone, setPhone] = useState(user?.phone?.replace('+234', '0') ?? '');
  const [amount, setAmount] = useState('');
  const [plan, setPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const limits = useQuery({
    queryKey: ['estate', estateId, 'topups', 'limits'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/topups/limits', { params: { path: { estateId } } })),
  });
  const plans = useQuery({
    queryKey: ['estate', estateId, 'topups', 'plans', network],
    enabled: kind === 'data' && Boolean(limits.data?.available),
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/topups/data-plans', {
          params: { path: { estateId }, query: { network } },
        }),
      ),
  });
  const chosenPlan = plans.data?.find((p) => p.code === plan);
  const kobo = kind === 'airtime' ? wholeNairaToKobo(amount) : (chosenPlan?.amountKobo ?? null);

  const buy = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/topups', {
          params: { path: { estateId } },
          headers: { 'Idempotency-Key': key.current },
          body: {
            kind,
            network,
            phone: phone.trim(),
            ...(kind === 'airtime' ? { amountKobo: kobo ?? 0 } : { planCode: plan ?? '' }),
            ...(inExpoGo ? {} : { callbackUrl: 'safezone://wallet/return' }),
            ...payFields(payChoice.choice),
          },
        }),
      ),
    onSuccess: (purchase) => {
      key.current = newIdempotencyKey();
      rememberWalletItem({ kind: 'topup', id: purchase.id });
      router.replace(`/wallet/topup/${purchase.id}`);
      if (purchase.authorizationUrl) void Linking.openURL(purchase.authorizationUrl);
    },
    onError: () => {
      key.current = newIdempotencyKey();
    },
  });

  const submit = () => {
    if (!/^0[789][01]\d{8}$/.test(phone.replace(/\s/g, '')))
      return setError(t('res.topup.phoneInvalid'));
    if (kind === 'data' && !chosenPlan) return setError(t('res.topup.choosePlan'));
    const l = limits.data;
    if (kind === 'airtime' && (!kobo || !l || kobo < l.airtimeMinKobo || kobo > l.airtimeMaxKobo))
      return setError(t('res.topup.amountInvalid'));
    setError(null);
    buy.mutate();
  };

  const title = kind === 'airtime' ? t('res.topup.airtimeTitle') : t('res.topup.dataTitle');
  if (limits.data && !limits.data.available)
    return (
      <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
        <ScreenHeader
          title={title}
          onBack={() => router.back()}
          backIcon={<Icon name="arrow-back" />}
        />
        <Banner tone="info">{t('res.topup.unavailable')}</Banner>
      </ScrollScreen>
    );

  return (
    <ScrollScreen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        <ActionButton
          label={t('res.topup.submit', { amount: kobo ? naira(kobo) : '' })}
          busy={buy.isPending}
          onPress={submit}
        />
      }
    >
      <ScreenHeader
        title={title}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      <ChipGroup
        label={t('res.topup.network')}
        value={network}
        onChange={(value) => {
          setNetwork(value);
          setPlan(null);
        }}
        options={NETWORKS.map((key) => ({ key, label: NETWORK_LABELS[key] }))}
      />
      <TextField
        label={t('res.topup.phone')}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        maxLength={14}
      />
      {kind === 'airtime' ? (
        <TextField
          label={t('res.topup.amount')}
          helper={
            limits.data
              ? t('res.topup.limits', {
                  min: (limits.data.airtimeMinKobo / 100).toLocaleString('en-NG'),
                  max: (limits.data.airtimeMaxKobo / 100).toLocaleString('en-NG'),
                })
              : undefined
          }
          value={amount}
          onChangeText={setAmount}
          keyboardType="number-pad"
          maxLength={7}
        />
      ) : plans.isPending ? (
        <Skeleton height={120} />
      ) : plans.isError ? (
        <Banner tone="danger">{errorText(plans.error)}</Banner>
      ) : (
        <ChipGroup
          label={t('res.topup.plan')}
          value={plan}
          onChange={setPlan}
          options={(plans.data ?? []).map((p) => ({
            key: p.code,
            label: `${p.name} · ${naira(p.amountKobo)}`,
          }))}
        />
      )}
      {payChoice.element}
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {buy.isError ? <Banner tone="danger">{errorText(buy.error)}</Banner> : null}
    </ScrollScreen>
  );
}
