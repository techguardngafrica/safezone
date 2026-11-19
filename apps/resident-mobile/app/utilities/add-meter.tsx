import { type ApiData, unwrap } from '@safezone/api-client';
import { colors, spacing, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ChipGroup,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
  StatusPill,
  TextField,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import { publicProviders } from '../../src/features/utilities';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';

type LookupResult = ApiData<'/v1/estates/{estateId}/meters/lookup', 'post'>;

/** Add a public DisCo meter: pick provider, verify meter number, confirm account name, save. */
export default function AddMeterScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { estateId, household } = useResident();
  const [providerCode, setProviderCode] = useState<string | null>(null);
  const [meterNumber, setMeterNumber] = useState('');
  const [verified, setVerified] = useState<LookupResult | null>(null);

  const providers = useQuery({
    queryKey: ['estate', estateId, 'utility-providers'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/utility-providers', { params: { path: { estateId } } }),
      ),
  });
  const list = publicProviders(providers.data ?? []);
  const selectedProvider = list.find((item) => item.code === providerCode) ?? null;

  const lookup = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/meters/lookup', {
          params: { path: { estateId } },
          body: { providerCode: providerCode ?? '', meterNumber: meterNumber.trim() },
        }),
      ),
    onSuccess: (result) => setVerified(result),
  });

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/meters', {
          params: { path: { estateId } },
          body: {
            spaceId: household?.unit.id ?? '',
            type: selectedProvider?.type ?? 'electricity',
            supply: 'public',
            providerCode: providerCode ?? '',
            meterNumber: meterNumber.trim(),
          },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'meters'] });
      router.back();
    },
  });

  const canLookup = Boolean(providerCode && meterNumber.trim().length >= 6);

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        title={t('res.utilities.addTitle')}
        subtitle={household?.unit.code}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />

      {!household ? <Banner tone="warning">{t('res.utilities.noUnit')}</Banner> : null}
      {providers.isPending ? <Skeleton height={120} /> : null}
      {providers.isError ? (
        <ErrorState message={errorText(providers.error)} onRetry={() => void providers.refetch()} />
      ) : null}

      {list.length > 0 && household ? (
        <Card>
          <ChipGroup<string>
            label={t('res.utilities.provider')}
            value={providerCode}
            onChange={(next) => {
              setProviderCode(next);
              setVerified(null);
            }}
            options={list.map((item) => ({ key: item.code, label: item.name }))}
          />
          <TextField
            label={t('res.utilities.meterNumber')}
            placeholder={t('res.utilities.meterPlaceholder')}
            value={meterNumber}
            onChangeText={(value) => {
              setMeterNumber(value);
              setVerified(null);
            }}
            autoCapitalize="characters"
            maxLength={20}
          />
          {lookup.isError ? <Banner tone="danger">{errorText(lookup.error)}</Banner> : null}
          <ActionButton
            label={t('res.utilities.verify')}
            variant={verified ? 'outline' : 'primary'}
            disabled={!canLookup}
            busy={lookup.isPending}
            onPress={() => lookup.mutate()}
          />
        </Card>
      ) : null}

      {verified ? (
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.accountName}>
              {t('res.utilities.verifiedAccount', { name: verified.accountName })}
            </Text>
            <StatusPill
              tone="success"
              label={verified.prepaid ? t('res.utilities.prepaid') : t('res.utilities.postpaid')}
            />
          </View>
          {save.isError ? <Banner tone="danger">{errorText(save.error)}</Banner> : null}
          <ActionButton
            label={t('res.utilities.saveMeter')}
            busy={save.isPending}
            onPress={() => save.mutate()}
          />
        </Card>
      ) : null}
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing[2],
  },
  accountName: {
    flex: 1,
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    color: colors.semantic.text,
  },
});
