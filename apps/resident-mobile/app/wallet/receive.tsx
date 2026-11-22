import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ChipGroup,
  ScreenHeader,
  ScrollScreen,
  TextField,
  ToggleRow,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Icon } from '../../src/components/icon';
import { marketStyles } from '../../src/features/market-text';
import { errorText } from '../../src/lib/errors';
import { api } from '../../src/lib/session';

/** Receive money from neighbours (ADR-0025): a payout account held by the payment provider. */
export default function ReceiveMoneyScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [bankCode, setBankCode] = useState<string | null>(null);
  const [account, setAccount] = useState('');
  const payout = useQuery({
    queryKey: ['me', 'payout-account'],
    queryFn: () => unwrap(api.GET('/v1/me/payout-account')),
  });
  const showForm = editing || payout.data === null;
  const banks = useQuery({
    queryKey: ['payments', 'banks'],
    enabled: showForm,
    queryFn: () => unwrap(api.GET('/v1/payments/banks')),
  });
  const link = useMutation({
    mutationFn: () =>
      unwrap(
        api.PUT('/v1/me/payout-account', {
          body: { bankCode: bankCode ?? '', accountNumber: account.trim() },
        }),
      ),
    onSuccess: (data) => {
      qc.setQueryData(['me', 'payout-account'], data);
      setEditing(false);
      setAccount('');
    },
  });
  const toggle = useMutation({
    mutationFn: (acceptTransfers: boolean) =>
      unwrap(api.PATCH('/v1/me/payout-account', { body: { acceptTransfers } })),
    onSuccess: (data) => qc.setQueryData(['me', 'payout-account'], data),
  });
  const valid = Boolean(bankCode) && /^\d{10}$/.test(account.trim());

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        title={t('res.receive.title')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      <Banner tone="info">{t('res.receive.intro')}</Banner>
      {payout.data ? (
        <Card>
          <Text style={marketStyles.title}>
            {t('res.receive.current', {
              bank: payout.data.bankName,
              last4: payout.data.accountLast4,
            })}
          </Text>
          <ToggleRow
            label={t('res.receive.accept')}
            value={payout.data.acceptTransfers}
            disabled={toggle.isPending}
            onChange={(value) => toggle.mutate(value)}
          />
          {!editing ? (
            <ActionButton
              label={t('res.receive.change')}
              variant="outline"
              onPress={() => setEditing(true)}
            />
          ) : null}
        </Card>
      ) : null}
      {showForm ? (
        <>
          {banks.data ? (
            <ChipGroup
              label={t('res.receive.bank')}
              value={bankCode}
              onChange={setBankCode}
              options={banks.data.map((bank) => ({ key: bank.code, label: bank.name }))}
            />
          ) : null}
          <TextField
            label={t('res.receive.account')}
            helper={t('res.receive.accountHelper')}
            value={account}
            onChangeText={(value) => setAccount(value.replace(/\D/g, '').slice(0, 10))}
            keyboardType="number-pad"
            maxLength={10}
          />
          <ActionButton
            label={t('res.receive.link')}
            busy={link.isPending}
            disabled={!valid}
            onPress={() => link.mutate()}
          />
        </>
      ) : null}
      {link.isError ? <Banner tone="danger">{errorText(link.error)}</Banner> : null}
      {toggle.isError ? <Banner tone="danger">{errorText(toggle.error)}</Banner> : null}
    </ScrollScreen>
  );
}
