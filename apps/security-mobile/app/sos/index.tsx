import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { formatElapsed, t } from '@safezone/i18n';
import { EmptyState, ErrorState, Skeleton } from '@safezone/mobile-ui';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackRow, BodyText, gateStyles, GateTitle } from '../../src/components/gate-ui';
import { Icon } from '../../src/components/icon';
import { categoryText, useActiveSos } from '../../src/features/sos';
import { errorText, isNetworkError } from '../../src/lib/errors';

/** Active SOS alerts for the estate, newest first. */
export default function SosList() {
  const active = useActiveSos();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <SafeAreaView style={gateStyles.screen}>
      <FlatList
        data={active.data ?? []}
        keyExtractor={(alert) => alert.id}
        contentContainerStyle={gateStyles.content}
        ListHeaderComponent={
          <View style={{ gap: spacing[3] }}>
            <BackRow onBack={() => router.back()} />
            <GateTitle>{t('sec.sos.title')}</GateTitle>
          </View>
        }
        ListEmptyComponent={
          active.isPending ? (
            <Skeleton height={96} />
          ) : active.isError ? (
            isNetworkError(active.error) ? (
              <BodyText>{t('sec.sos.offline')}</BodyText>
            ) : (
              <ErrorState message={errorText(active.error)} onRetry={() => void active.refetch()} />
            )
          ) : (
            <EmptyState title={t('sec.sos.empty')} />
          )
        }
        renderItem={({ item }) => {
          const unit = item.unitCode
            ? t('sec.sos.unit', { unit: item.unitCode })
            : t('sec.sos.noUnit');
          const status = t(`sos.status.${item.status}`);
          const ago = t('sec.sos.ago', { time: formatElapsed(item.triggeredAt, now) });
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${categoryText(item.category)}, ${unit}, ${status}, ${ago}`}
              onPress={() => router.push(`/sos/${item.id}`)}
              style={({ pressed }) => [
                styles.row,
                item.status === 'triggered' && styles.rowNew,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Icon
                name="warning"
                size={36}
                color={item.status === 'triggered' ? colors.neutral[0] : colors.status.danger}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.title, item.status === 'triggered' && styles.light]}>
                  {item.isDrill ? `${t('sec.sos.drill')} · ` : ''}
                  {categoryText(item.category)}
                </Text>
                <Text style={[styles.meta, item.status === 'triggered' && styles.light]}>
                  {unit} · {status} · {ago}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: radii.lg,
    borderWidth: 3,
    borderColor: colors.status.danger,
    backgroundColor: colors.neutral[0],
  },
  rowNew: { backgroundColor: colors.status.danger },
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  meta: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
    color: colors.semantic.textMuted,
  },
  light: { color: colors.neutral[0] },
});
