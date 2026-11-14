import { unwrap } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ConfirmModal,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
  StatusPill,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Share, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import { QrCode } from '../../src/components/qr-code';
import { isUpcoming, PASS_TONE, passStatusLabel, passTypeLabel } from '../../src/features/passes';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

/** Pass: large QR, 6-digit PIN, validity, share, revoke. No ads on this screen (UI_GUIDELINES §8.1). */
export default function PassScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId, estateName } = useResident();
  const [revoking, setRevoking] = useState(false);
  const [reason, setReason] = useState('');

  const pass = useQuery({
    queryKey: ['estate', estateId, 'visitor-pass', id],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/visitor-passes/{id}', {
          params: { path: { estateId, id } },
        }),
      ),
  });
  const sms = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/visitor-passes/{id}/share', {
          params: { path: { estateId, id } },
        }),
      ),
  });
  const revoke = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/visitor-passes/{id}/revoke', {
          params: { path: { estateId, id } },
          body: { reason: reason.trim() },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'visitor-pass', id] });
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'visitor-passes'] });
      setRevoking(false);
    },
  });

  const data = pass.data;
  const pull = usePullRefresh(pass.refetch);
  const share = async () => {
    if (!data) return;
    await Share.share({
      message: t('res.pass.shareMessage', {
        name: data.visitorName,
        estate: estateName,
        from: formatDateTime(data.validFrom),
        to: formatDateTime(data.validTo),
        pin: data.pin,
        link: data.passUrl,
      }),
    });
  };

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={data?.visitorName ?? t('res.pass.title')}
        subtitle={data ? passTypeLabel(data.type) : undefined}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/visitors'))}
        backIcon={<Icon name="arrow-back" />}
      />
      {pass.isPending ? <Skeleton height={300} /> : null}
      {pass.isError ? (
        <ErrorState message={errorText(pass.error)} onRetry={() => void pass.refetch()} />
      ) : null}
      {data ? (
        <>
          <StatusPill tone={PASS_TONE[data.status]} label={passStatusLabel(data.status)} />
          {isUpcoming(data) ? (
            <Card style={{ alignItems: 'center', gap: spacing[4] }}>
              <QrCode value={data.qr} label={t('res.pass.qrLabel', { name: data.visitorName })} />
              <View style={{ alignItems: 'center', gap: spacing[1] }}>
                <Text style={styles.pinLabel}>{t('res.pass.pin')}</Text>
                <Text
                  style={styles.pin}
                  accessibilityLabel={data.pin.split('').join(' ')}
                  selectable
                >
                  {data.pin}
                </Text>
              </View>
              <Text style={styles.hint}>{t('res.pass.showAtGate')}</Text>
            </Card>
          ) : (
            <Banner tone={data.status === 'revoked' ? 'danger' : 'info'}>
              {data.status === 'revoked' ? t('res.pass.revokedNote') : t('res.pass.endedNote')}
            </Banner>
          )}
          <Card>
            <Row label={t('res.pass.validFrom')} value={formatDateTime(data.validFrom)} />
            <Row label={t('res.pass.validTo')} value={formatDateTime(data.validTo)} />
            {data.vehiclePlate ? (
              <Row label={t('res.pass.plate')} value={data.vehiclePlate} />
            ) : null}
            <Row
              label={t('res.pass.uses')}
              value={data.maxUses ? `${data.usesCount} / ${data.maxUses}` : String(data.usesCount)}
            />
          </Card>
          {isUpcoming(data) ? (
            <View style={{ gap: spacing[2] }}>
              <ActionButton
                label={t('res.pass.share')}
                icon={
                  <Icon
                    name={Platform.OS === 'ios' ? 'share-outline' : 'share-social-outline'}
                    color="#FFFFFF"
                    size={20}
                  />
                }
                onPress={() => void share()}
              />
              {data.visitorPhone ? (
                <ActionButton
                  label={sms.isSuccess ? t('res.pass.smsSent') : t('res.pass.sendSms')}
                  variant="outline"
                  busy={sms.isPending}
                  disabled={sms.isSuccess}
                  onPress={() => sms.mutate()}
                />
              ) : null}
              {sms.isError ? <Banner tone="danger">{errorText(sms.error)}</Banner> : null}
              <ActionButton
                label={t('passes.revoke')}
                variant="text"
                onPress={() => setRevoking(true)}
              />
            </View>
          ) : null}
          <ConfirmModal
            visible={revoking}
            title={t('passes.revokeConfirm.title')}
            body={t('passes.revokeConfirm.body', { name: data.visitorName })}
            confirmLabel={t('passes.revoke')}
            cancelLabel={t('passes.revokeConfirm.keep')}
            destructive
            busy={revoke.isPending}
            error={revoke.isError ? errorText(revoke.error) : null}
            reason={{
              label: t('passes.revokeConfirm.reason'),
              value: reason,
              onChange: setReason,
              required: true,
            }}
            onConfirm={() => revoke.mutate()}
            onCancel={() => setRevoking(false)}
          />
        </>
      ) : null}
    </ScrollScreen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pinLabel: { fontSize: typography.size.sm, color: colors.semantic.textMuted },
  pin: {
    fontSize: 32,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    letterSpacing: 6,
    color: colors.semantic.text,
    fontWeight: typography.weight.bold,
    backgroundColor: colors.semantic.surfaceMuted,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radii.md,
  },
  hint: { fontSize: typography.size.sm, color: colors.semantic.textMuted, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing[3],
    minHeight: 32,
    alignItems: 'center',
  },
  rowLabel: { fontSize: typography.size.sm, color: colors.semantic.textMuted },
  rowValue: {
    fontSize: typography.size.sm,
    color: colors.semantic.text,
    fontWeight: typography.weight.medium,
    flexShrink: 1,
    textAlign: 'right',
  },
});
