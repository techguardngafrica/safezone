import { unwrap } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { formatDateTime, formatKobo, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Card,
  ChipGroup,
  EmptyState,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  SectionHeader,
  Skeleton,
  StatusPill,
  type Tone,
} from '@safezone/mobile-ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import { todayWat } from '../../src/features/bills';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

type RangeKey = '30d' | '90d' | 'year' | 'all';

function rangeDates(range: RangeKey): { from?: string; to?: string } {
  if (range === 'all') return {};
  const today = todayWat();
  if (range === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  const days = range === '30d' ? 30 : 90;
  const fromDate = new Date(Date.now() + 3_600_000 - days * 86_400_000).toISOString().slice(0, 10);
  return { from: fromDate, to: today };
}

const LINE_TONE: Record<string, Tone> = {
  invoice: 'neutral',
  payment: 'success',
  credit_note: 'info',
  waiver: 'info',
  adjustment: 'warning',
};

/** Account statement (resident-mobile.md §6.6): opening/closing balance and activity lines. */
export default function StatementScreen() {
  const router = useRouter();
  const { estateId, estateName } = useResident();
  const [range, setRange] = useState<RangeKey>('90d');
  const query = useMemo(() => rangeDates(range), [range]);

  const statement = useQuery({
    queryKey: ['estate', estateId, 'statement', range],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/statements', {
          params: { path: { estateId }, query },
        }),
      ),
  });
  const pull = usePullRefresh(statement.refetch);
  const data = statement.data;

  const shareStatement = () => {
    if (!data) return;
    void Share.share({
      message: t('res.statement.shareText', {
        estate: estateName,
        opening: formatKobo(data.openingBalance),
        closing: formatKobo(data.closingBalance),
        count: data.lines.length,
      }),
    });
  };

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={t('res.statement.title')}
        subtitle={estateName}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/pay'))}
        backIcon={<Icon name="arrow-back" />}
      />

      <ChipGroup<RangeKey>
        label={t('res.statement.title')}
        value={range}
        onChange={setRange}
        options={[
          { key: '30d', label: t('res.statement.range.30d') },
          { key: '90d', label: t('res.statement.range.90d') },
          { key: 'year', label: t('res.statement.range.year') },
          { key: 'all', label: t('res.statement.range.all') },
        ]}
      />

      {statement.isPending ? <Skeleton height={160} /> : null}
      {statement.isError ? (
        <ErrorState message={errorText(statement.error)} onRetry={() => void statement.refetch()} />
      ) : null}

      {data ? (
        <>
          <Card>
            <SummaryRow
              label={t('res.statement.opening')}
              value={formatKobo(data.openingBalance)}
            />
            {data.unallocatedCredit > 0 ? (
              <SummaryRow
                label={t('res.statement.unallocated')}
                value={formatKobo(data.unallocatedCredit)}
              />
            ) : null}
            <View style={styles.divider} />
            <SummaryRow
              label={t('res.statement.closing')}
              value={formatKobo(data.closingBalance)}
              strong
            />
            <ActionButton
              label={t('res.statement.share')}
              variant="outline"
              icon={<Icon name="share-outline" color={colors.brand.primary} size={18} />}
              onPress={shareStatement}
            />
          </Card>

          <SectionHeader title={t('res.statement.entries')} />
          {data.lines.length === 0 ? (
            <EmptyState
              icon={<Icon name="document-text-outline" size={28} color={colors.brand.primary} />}
              title={t('res.statement.empty')}
              body={t('res.statement.emptyBody')}
            />
          ) : (
            data.lines.map((line, index) => {
              const isCredit = line.credit > 0;
              const amountText = isCredit
                ? `- ${formatKobo(line.credit)}`
                : `+ ${formatKobo(line.debit)}`;
              return (
                <Card key={`${line.date}-${line.reference ?? index}`}>
                  <View style={styles.lineTop}>
                    <StatusPill
                      tone={LINE_TONE[line.type] ?? 'neutral'}
                      label={t(`res.statement.type.${line.type}` as MessageKey)}
                    />
                    <Text
                      style={[
                        styles.amount,
                        { color: isCredit ? colors.status.success : colors.semantic.text },
                      ]}
                    >
                      {amountText}
                    </Text>
                  </View>
                  <Text style={styles.desc}>{line.description}</Text>
                  <View style={styles.lineBottom}>
                    <Text style={styles.meta}>
                      {formatDateTime(line.date)}
                      {line.reference ? ` · ${line.reference}` : ''}
                    </Text>
                    <Text style={styles.balance}>
                      {t('res.statement.runningBalance', { amount: formatKobo(line.balance) })}
                    </Text>
                  </View>
                </Card>
              );
            })
          )}
        </>
      ) : null}
    </ScrollScreen>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, strong && styles.strongText]}>{label}</Text>
      <Text style={[styles.summaryValue, strong && styles.strongValue]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  divider: {
    height: 1,
    backgroundColor: colors.semantic.borderSubtle,
    marginVertical: spacing[1],
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 30,
  },
  summaryLabel: {
    fontSize: typography.size.sm,
    color: colors.semantic.textMuted,
  },
  summaryValue: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    color: colors.semantic.text,
    fontVariant: ['tabular-nums'],
  },
  strongText: {
    color: colors.semantic.text,
    fontWeight: typography.weight.bold,
  },
  strongValue: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
  },
  lineTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing[2],
  },
  amount: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.bold,
    fontVariant: ['tabular-nums'],
  },
  desc: {
    fontSize: typography.size.md,
    color: colors.semantic.text,
  },
  lineBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing[2],
    flexWrap: 'wrap',
  },
  meta: {
    fontSize: typography.size.xs,
    color: colors.semantic.textMuted,
  },
  balance: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    color: colors.semantic.textMuted,
    fontVariant: ['tabular-nums'],
    backgroundColor: colors.semantic.surfaceMuted,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radii.sm,
  },
});
