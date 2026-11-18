import { unwrap } from '@safezone/api-client';
import { colors, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { ActionButton, Card, Skeleton } from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Share, Text, View } from 'react-native';
import { errorText } from '../lib/errors';
import { useResident } from '../lib/resident';
import { api } from '../lib/session';

/**
 * Pay by bank transfer (UI_GUIDELINES §8.1): a dedicated account for the household's unit. Transfers
 * settle to the estate and are matched to bills automatically. There is no wallet.
 */
export function BankTransferCard() {
  const queryClient = useQueryClient();
  const { estateId, household } = useResident();
  const accounts = useQuery({
    queryKey: ['estate', estateId, 'virtual-accounts', 'mine'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/virtual-accounts/mine', { params: { path: { estateId } } }),
      ),
  });
  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/virtual-accounts', {
          params: { path: { estateId } },
          body: { spaceId: household?.unit.id ?? '' },
        }),
      ),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'virtual-accounts'] }),
  });
  const account = accounts.data?.find(
    (item) => item.status === 'active' && (!household || item.spaceId === household.unit.id),
  );

  return (
    <Card>
      <Text
        style={{ fontSize: typography.size.md, fontWeight: '600', color: colors.semantic.text }}
      >
        {t('res.bills.transferTitle')}
      </Text>
      {accounts.isPending ? <Skeleton height={60} /> : null}
      {account ? (
        <>
          <Text
            selectable
            style={{
              fontSize: typography.size.xl,
              fontWeight: '700',
              letterSpacing: 1,
              color: colors.semantic.text,
            }}
          >
            {account.accountNumber}
          </Text>
          <Text style={{ color: colors.semantic.text }}>
            {account.bankName} · {account.accountName}
          </Text>
          <Text style={{ color: colors.semantic.textMuted, fontSize: typography.size.sm }}>
            {t('res.bills.transferHelp')}
          </Text>
          <View>
            <ActionButton
              label={t('res.bills.shareAccount')}
              variant="outline"
              onPress={() =>
                void Share.share({
                  message: t('res.bills.shareMessage', {
                    number: account.accountNumber,
                    bank: account.bankName,
                    name: account.accountName,
                  }),
                })
              }
            />
          </View>
        </>
      ) : null}
      {accounts.data && !account ? (
        <>
          <Text style={{ color: colors.semantic.textMuted, fontSize: typography.size.sm }}>
            {t('res.bills.transferNone')}
          </Text>
          <ActionButton
            label={t('res.bills.getAccount')}
            variant="outline"
            busy={create.isPending}
            disabled={!household}
            onPress={() => create.mutate()}
          />
        </>
      ) : null}
      {create.isError || accounts.isError ? (
        <Text style={{ color: colors.status.danger, fontSize: typography.size.sm }}>
          {errorText(create.error ?? accounts.error)}
        </Text>
      ) : null}
    </Card>
  );
}
