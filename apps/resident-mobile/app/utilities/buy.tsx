import { newIdempotencyKey, unwrap } from '@safezone/api-client';
import { colors, spacing, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ChipGroup,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
  TextField,
} from '@safezone/mobile-ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, Text } from 'react-native';
import { Icon } from '../../src/components/icon';
import {
  amountOk,
  nairaText,
  nairaToKobo,
  QUICK_AMOUNTS,
  rememberPurchase,
} from '../../src/features/tokens';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';

/** Expo Go cannot receive safezone:// links; installed builds return to the app after checkout. */
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/**
 * Buy a prepaid electricity token (ADR-0018). Safezone is the seller; the token appears only after the
 * payment is verified and the token is vended, otherwise the money is refunded. No ads on this flow.
 */
export default function BuyTokenScreen() {
  const router = useRouter();
  const { estateId } = useResident();
  const { meterId, meterNumber } = useLocalSearchParams<{
    meterId: string;
    meterNumber?: string;
  }>();
  const [choice, setChoice] = useState<string>(String(QUICK_AMOUNTS[1]));
  const [custom, setCustom] = useState('');
  const key = useRef(newIdempotencyKey());

  const limits = useQuery({
    queryKey: ['estate', estateId, 'utility-purchases', 'limits'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/utility-purchases/limits', {
          params: { path: { estateId } },
        }),
      ),
  });

  const amountKobo = choice === 'other' ? nairaToKobo(custom) : Number(choice);
  const min = limits.data?.minKobo ?? 100_000;
  const max = limits.data?.maxKobo ?? 20_000_000;
  const fee = limits.data?.feeKobo ?? 0;
  const valid = amountOk(amountKobo, min, max);
  const total = (amountKobo ?? 0) + fee;

  const buy = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/utility-purchases', {
          params: { path: { estateId } },
          headers: { 'Idempotency-Key': key.current },
          body: {
            meterId,
            amountKobo: amountKobo ?? 0,
            ...(inExpoGo ? {} : { callbackUrl: 'safezone://utilities/return' }),
          },
        }),
      ),
    onSuccess: (purchase) => {
      key.current = newIdempotencyKey();
      rememberPurchase(purchase.id);
      router.replace(`/utilities/purchase/${purchase.id}`);
      if (purchase.authorizationUrl) void Linking.openURL(purchase.authorizationUrl);
    },
    onError: () => {
      key.current = newIdempotencyKey();
    },
  });

  return (
    <ScrollScreen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        limits.data?.available ? (
          <ActionButton
            label={t('res.tokens.pay', { total: nairaText(total) })}
            disabled={!valid}
            busy={buy.isPending}
            onPress={() => buy.mutate()}
          />
        ) : undefined
      }
    >
      <ScreenHeader
        title={t('res.tokens.title')}
        subtitle={meterNumber ? t('res.tokens.meter', { number: meterNumber }) : undefined}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      {limits.isPending ? <Skeleton height={160} /> : null}
      {limits.isError ? <Banner tone="danger">{errorText(limits.error)}</Banner> : null}
      {limits.data && !limits.data.available ? (
        <Banner tone="info">{t('res.tokens.unavailable')}</Banner>
      ) : null}
      {limits.data?.available ? (
        <>
          <Card>
            <ChipGroup<string>
              label={t('res.tokens.amount')}
              value={choice}
              onChange={setChoice}
              options={[
                ...QUICK_AMOUNTS.map((kobo) => ({ key: String(kobo), label: nairaText(kobo) })),
                { key: 'other', label: t('res.tokens.custom') },
              ]}
            />
            {choice === 'other' ? (
              <TextField
                label={t('res.tokens.custom')}
                value={custom}
                onChangeText={setCustom}
                keyboardType="number-pad"
                placeholder={t('res.tokens.customPlaceholder')}
                maxLength={9}
                error={
                  custom && !valid
                    ? t('res.tokens.amountInvalid', { min: nairaText(min), max: nairaText(max) })
                    : null
                }
                helper={t('res.tokens.limits', { min: nairaText(min), max: nairaText(max) })}
              />
            ) : null}
            <Text style={{ color: colors.semantic.textMuted }}>
              {fee > 0 ? t('res.tokens.fee', { fee: nairaText(fee) }) : t('res.tokens.noFee')}
            </Text>
            {valid ? (
              <Text style={{ color: colors.semantic.text, fontWeight: typography.weight.bold }}>
                {t('res.tokens.total', { total: nairaText(total) })}
              </Text>
            ) : null}
          </Card>
          <Text style={{ color: colors.semantic.textMuted, marginTop: spacing[1] }}>
            {t('res.tokens.seller')}
          </Text>
          {buy.isError ? <Banner tone="danger">{errorText(buy.error)}</Banner> : null}
        </>
      ) : null}
    </ScrollScreen>
  );
}
