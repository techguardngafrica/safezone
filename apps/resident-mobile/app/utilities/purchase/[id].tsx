import { unwrap } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { formatDateTime, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
  StatusPill,
} from '@safezone/mobile-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Linking, Share, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../../src/components/icon';
import {
  isInProgress,
  nairaText,
  TOKEN_TONE,
  type TokenPurchase,
} from '../../../src/features/tokens';
import { errorText } from '../../../src/lib/errors';
import { useResident } from '../../../src/lib/resident';
import { api } from '../../../src/lib/session';

/**
 * One token purchase (ADR-0018): payment, vending, then the token. "Paid" only after the API verified the
 * payment; the token only after it was vended. No ads on this screen.
 */
export default function TokenPurchaseScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { estateId } = useResident();
  const { id } = useLocalSearchParams<{ id: string }>();
  const key = ['estate', estateId, 'utility-purchase', id];

  // While payment is pending, ask the provider through the API (the webhook may be slower).
  const purchase = useQuery({
    queryKey: key,
    queryFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/utility-purchases/{id}/verify', {
          params: { path: { estateId, id } },
        }),
      ),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isInProgress(status) ? 4_000 : false;
    },
  });

  useFocusEffect(
    useCallback(() => {
      void purchase.refetch();
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'utility-purchases'] });
    }, [id]),
  );

  const data: TokenPurchase | undefined = purchase.data;

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        title={t('res.tokens.purchaseTitle')}
        subtitle={data ? t('res.tokens.meter', { number: data.meterNumber }) : undefined}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/utilities'))}
        backIcon={<Icon name="arrow-back" />}
      />
      {purchase.isPending ? <Skeleton height={180} /> : null}
      {purchase.isError ? (
        <ErrorState message={errorText(purchase.error)} onRetry={() => void purchase.refetch()} />
      ) : null}
      {data ? (
        <>
          <Card>
            <View style={styles.row}>
              <Text style={styles.amount}>{nairaText(data.totalKobo)}</Text>
              <StatusPill
                tone={TOKEN_TONE[data.status]}
                label={t(`res.tokens.status.${data.status}` as MessageKey)}
              />
            </View>
            <Text style={styles.muted}>
              {data.providerCode} · {formatDateTime(data.createdAt)}
            </Text>
          </Card>

          {data.status === 'vended' && data.token ? (
            <Card>
              <Text accessibilityRole="header" style={styles.label}>
                {t('res.tokens.token')}
              </Text>
              <Text
                selectable
                style={styles.token}
                accessibilityLabel={data.token.split('').join(' ')}
              >
                {data.token}
              </Text>
              {data.unitsKwh !== null ? (
                <Text style={styles.muted}>{t('res.tokens.units', { units: data.unitsKwh })}</Text>
              ) : null}
              <Text style={styles.muted}>{t('res.tokens.tokenHint')}</Text>
              <ActionButton
                label={t('res.tokens.share')}
                variant="outline"
                icon={<Icon name="share-outline" color={colors.brand.primary} size={18} />}
                onPress={() =>
                  void Share.share({
                    message: t('res.tokens.shareText', {
                      meter: data.meterNumber,
                      token: data.token ?? '',
                    }),
                  })
                }
              />
            </Card>
          ) : null}

          {data.status === 'created' && data.authorizationUrl ? (
            <ActionButton
              label={t('res.tokens.continuePayment')}
              onPress={() => void Linking.openURL(data.authorizationUrl ?? '')}
            />
          ) : null}
          {data.status === 'created' ? (
            <ActionButton
              label={t('res.tokens.checkAgain')}
              variant="text"
              busy={purchase.isFetching}
              onPress={() => void purchase.refetch()}
            />
          ) : null}
          {data.status === 'refund_pending' || data.status === 'refunded' ? (
            <Banner tone="warning">{t('res.tokens.refundNote')}</Banner>
          ) : null}
          {data.status === 'failed' ? (
            <Banner tone="info">{t('res.tokens.failedNote')}</Banner>
          ) : null}
        </>
      ) : null}
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amount: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  muted: { fontSize: typography.size.sm, color: colors.semantic.textMuted },
  label: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    color: colors.semantic.textMuted,
  },
  token: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    fontFamily: 'monospace',
    letterSpacing: 1,
    color: colors.semantic.text,
    backgroundColor: colors.semantic.surfaceMuted,
    borderRadius: radii.md,
    padding: spacing[3],
    textAlign: 'center',
  },
});
