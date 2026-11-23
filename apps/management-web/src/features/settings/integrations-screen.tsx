'use client';

import { ApiClientError, type ApiData, unwrap } from '@safezone/api-client';
import { formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Dialog,
  EmptyState,
  ErrorState,
  FormError,
  InputField,
  PageHeader,
  Panel,
  SelectField,
  Skeleton,
  StatusPill,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { api } from '../../../lib/session';

type PayoutAccount = ApiData<'/v1/estates/{estateId}/payout-account', 'get'>;

function PayoutSetupDialog({ isUpdate, onClose }: { isUpdate: boolean; onClose: () => void }) {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [bankError, setBankError] = useState<string | null>(null);
  const [nubanError, setNubanError] = useState<string | null>(null);

  const banksQuery = useQuery({
    queryKey: ['payments', 'banks'],
    queryFn: () => unwrap(api.GET('/v1/payments/banks')),
    staleTime: 10 * 60_000,
  });

  const setup = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/payout-account', {
          params: { path: { estateId } },
          body: { bankCode, accountNumber: accountNumber.trim() },
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(['estate', estateId, 'payout-account'], data);
      onClose();
    },
  });

  const submit = () => {
    const cleanNuban = accountNumber.trim();
    const nextBankErr = bankCode ? null : t('mw.integrations.payments.bankRequired');
    const nextNubanErr = /^\d{10}$/.test(cleanNuban)
      ? null
      : t('mw.integrations.payments.nubanInvalid');
    setBankError(nextBankErr);
    setNubanError(nextNubanErr);
    if (nextBankErr || nextNubanErr) return;
    setup.mutate();
  };

  return (
    <Dialog
      title={
        isUpdate
          ? t('mw.integrations.payments.dialogUpdateTitle')
          : t('mw.integrations.payments.dialogTitle')
      }
      onClose={onClose}
      onSubmit={submit}
      actions={
        <>
          <ActionButton variant="text" onClick={onClose}>
            {t('common.cancel')}
          </ActionButton>
          <ActionButton type="submit" busy={setup.isPending} disabled={banksQuery.isPending}>
            {t('mw.integrations.payments.submit')}
          </ActionButton>
        </>
      }
    >
      <div className="sz-form">
        <Banner tone="info">{t('mw.integrations.payments.directSettlementNote')}</Banner>
        {banksQuery.isError ? (
          <ErrorState
            message={errorText(banksQuery.error)}
            onRetry={() => void banksQuery.refetch()}
          />
        ) : (
          <>
            <SelectField
              label={t('mw.integrations.payments.bankField')}
              value={bankCode}
              onChange={(value) => {
                setBankCode(value);
                setBankError(null);
              }}
              error={bankError}
              options={[
                { value: '', label: t('mw.integrations.payments.bankPlaceholder') },
                ...(banksQuery.data ?? []).map((bank) => ({
                  value: bank.code,
                  label: bank.name,
                })),
              ]}
            />
            <InputField
              label={t('mw.integrations.payments.nubanField')}
              value={accountNumber}
              onChange={(value) => {
                setAccountNumber(value.replace(/\D/g, '').slice(0, 10));
                setNubanError(null);
              }}
              inputMode="numeric"
              maxLength={10}
              error={nubanError}
              helper={t('mw.integrations.payments.nubanHelp')}
            />
          </>
        )}
        <FormError message={setup.isError ? errorText(setup.error) : null} />
      </div>
    </Dialog>
  );
}

/** Estate integrations: payment subaccount status and setup (management-web.md §6.13). */
export function IntegrationsScreen() {
  const { estateId, hasFeature } = useEstate();
  const [setupOpen, setSetupOpen] = useState(false);
  const paymentsEnabled = hasFeature('payments');

  const payoutQuery = useQuery<PayoutAccount | null>({
    queryKey: ['estate', estateId, 'payout-account'],
    queryFn: async () => {
      try {
        return await unwrap(
          api.GET('/v1/estates/{estateId}/payout-account', { params: { path: { estateId } } }),
        );
      } catch (error) {
        if (error instanceof ApiClientError && error.statusCode === 404) return null;
        throw error;
      }
    },
    enabled: paymentsEnabled,
  });

  return (
    <>
      <PageHeader
        title={t('mw.integrations.title')}
        description={t('mw.integrations.description')}
      />
      <div style={{ display: 'grid', gap: 24, maxWidth: 840 }}>
        {!paymentsEnabled ? (
          <EmptyState
            icon="sliders"
            title={t('mw.integrations.emptyTitle')}
            body={t('mw.integrations.emptyBody')}
          />
        ) : (
          <Panel
            title={t('mw.integrations.payments.title')}
            actions={
              payoutQuery.data ? (
                <ActionButton variant="outline" size="sm" onClick={() => setSetupOpen(true)}>
                  {t('mw.integrations.payments.update')}
                </ActionButton>
              ) : null
            }
          >
            <div style={{ display: 'grid', gap: 16 }}>
              <Banner tone="info">{t('mw.integrations.payments.directSettlementNote')}</Banner>
              {payoutQuery.isPending ? <Skeleton height={120} /> : null}
              {payoutQuery.isError ? (
                <ErrorState
                  message={errorText(payoutQuery.error)}
                  onRetry={() => void payoutQuery.refetch()}
                />
              ) : null}
              {!payoutQuery.isPending && !payoutQuery.isError && payoutQuery.data === null ? (
                <EmptyState
                  icon="wallet"
                  title={t('mw.integrations.payments.emptyTitle')}
                  body={t('mw.integrations.payments.emptyBody')}
                  action={
                    <ActionButton onClick={() => setSetupOpen(true)}>
                      {t('mw.integrations.payments.link')}
                    </ActionButton>
                  }
                />
              ) : null}
              {payoutQuery.data ? (
                <dl
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 16,
                    margin: 0,
                  }}
                >
                  <div>
                    <dt className="sz-muted" style={{ fontSize: 12 }}>
                      {t('mw.integrations.payments.status')}
                    </dt>
                    <dd style={{ margin: '4px 0 0' }}>
                      <StatusPill
                        tone={payoutQuery.data.status === 'active' ? 'success' : 'warning'}
                        label={
                          payoutQuery.data.status === 'active'
                            ? t('mw.integrations.payments.status.active')
                            : t('mw.integrations.payments.status.disabled')
                        }
                      />
                    </dd>
                  </div>
                  <div>
                    <dt className="sz-muted" style={{ fontSize: 12 }}>
                      {t('mw.integrations.payments.provider')}
                    </dt>
                    <dd style={{ margin: '4px 0 0', fontWeight: 500, textTransform: 'capitalize' }}>
                      {payoutQuery.data.provider}
                    </dd>
                  </div>
                  <div>
                    <dt className="sz-muted" style={{ fontSize: 12 }}>
                      {t('mw.integrations.payments.bank')}
                    </dt>
                    <dd style={{ margin: '4px 0 0', fontWeight: 500 }}>
                      {payoutQuery.data.bankName}
                    </dd>
                  </div>
                  <div>
                    <dt className="sz-muted" style={{ fontSize: 12 }}>
                      {t('mw.integrations.payments.accountName')}
                    </dt>
                    <dd style={{ margin: '4px 0 0', fontWeight: 500 }}>
                      {payoutQuery.data.accountName}
                    </dd>
                  </div>
                  <div>
                    <dt className="sz-muted" style={{ fontSize: 12 }}>
                      {t('mw.integrations.payments.accountNumber')}
                    </dt>
                    <dd className="sz-num" style={{ margin: '4px 0 0', fontWeight: 500 }}>
                      {`••••${payoutQuery.data.accountLast4}`}
                    </dd>
                  </div>
                  <div>
                    <dt className="sz-muted" style={{ fontSize: 12 }}>
                      {t('mw.integrations.payments.verifiedAt')}
                    </dt>
                    <dd className="sz-num" style={{ margin: '4px 0 0' }}>
                      {formatDateTime(payoutQuery.data.verifiedAt)}
                    </dd>
                  </div>
                </dl>
              ) : null}
            </div>
          </Panel>
        )}
      </div>

      {setupOpen ? (
        <PayoutSetupDialog
          isUpdate={Boolean(payoutQuery.data)}
          onClose={() => setSetupOpen(false)}
        />
      ) : null}
    </>
  );
}
