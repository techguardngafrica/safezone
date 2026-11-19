import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { formatTime, t } from '@safezone/i18n';
import { EmptyState, TextField } from '@safezone/mobile-ui';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackRow, BodyText, gateStyles, GateTitle } from '../src/components/gate-ui';
import { Icon } from '../src/components/icon';
import { passTypeText, setVerification } from '../src/features/verification';
import { useGate } from '../src/lib/gate';
import { normalisePlate } from '../src/offline/decide';
import { pinDigest, verifyListed, type ExpectedPass } from '../src/offline/verify';

function windowText(pass: ExpectedPass): string {
  if (pass.recurrence)
    return t('sec.expected.window', { from: pass.recurrence.from, to: pass.recurrence.to });
  return t('sec.expected.window', {
    from: formatTime(pass.validFrom),
    to: formatTime(pass.validTo),
  });
}

function matches(pass: ExpectedPass, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (/^\d{6}$/.test(q) && pass.pinDigest === pinDigest(pass.id, q)) return true;
  const plate = normalisePlate(q);
  return (
    pass.visitorName.toLowerCase().includes(q) ||
    (pass.unitCode?.toLowerCase().includes(q) ?? false) ||
    (plate.length > 0 &&
      pass.vehiclePlate !== null &&
      normalisePlate(pass.vehiclePlate).includes(plate))
  );
}

/**
 * Passes expected at this gate in the next 24 hours, from the on-device list so it works offline
 * (security-mobile.md §7.1). Tapping a visitor runs the same check as a scan.
 */
export default function ExpectedScreen() {
  const { sync } = useGate();
  const [query, setQuery] = useState('');
  const list = sync.expected;

  const passes = useMemo(() => {
    const now = Date.now();
    return (list?.passes ?? [])
      .filter((pass) => new Date(pass.validTo).getTime() >= now)
      .filter((pass) => matches(pass, query))
      .sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  }, [list, query]);

  return (
    <SafeAreaView style={gateStyles.screen}>
      <FlatList
        data={passes}
        keyExtractor={(pass) => pass.id}
        contentContainerStyle={gateStyles.content}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: spacing[3] }}>
            <BackRow onBack={() => router.back()} />
            <GateTitle>{t('sec.expected.title')}</GateTitle>
            {list ? (
              <BodyText muted>
                {t('sec.expected.updated', { time: formatTime(list.generatedAt) })}
              </BodyText>
            ) : null}
            <TextField
              label={t('sec.expected.search')}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
            />
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title={
              !list
                ? t('sec.expected.notLoaded')
                : query
                  ? t('sec.expected.noMatch', { query })
                  : t('sec.expected.empty')
            }
          />
        }
        renderItem={({ item }) => (
          <ExpectedRow
            pass={item}
            revoked={sync.revokedPassIds.has(item.id)}
            onPress={() => {
              if (!sync.cache) return;
              setVerification({
                result: verifyListed(sync.cache, item.id, 'in'),
                direction: 'in',
                checkedAt: Date.now(),
              });
              router.push('/result');
            }}
          />
        )}
      />
    </SafeAreaView>
  );
}

function ExpectedRow({
  pass,
  revoked,
  onPress,
}: {
  pass: ExpectedPass;
  revoked: boolean;
  onPress: () => void;
}) {
  const details = [pass.unitCode, passTypeText(pass.type), pass.vehiclePlate, windowText(pass)]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${pass.visitorName}, ${details}${revoked ? `, ${t('sec.expected.revoked')}` : ''}`}
      accessibilityHint={t('sec.expected.check')}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
    >
      <View style={{ flex: 1, gap: spacing[1] }}>
        <Text style={styles.name}>{pass.visitorName}</Text>
        <Text style={styles.details}>{details}</Text>
      </View>
      {revoked ? (
        <Text style={styles.revoked}>{t('sec.expected.revoked')}</Text>
      ) : (
        <Icon name="chevron-forward" size={28} color={colors.brand.primary} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.semantic.border,
    backgroundColor: colors.neutral[0],
  },
  name: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  details: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
    color: colors.semantic.textMuted,
  },
  revoked: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.bold,
    color: colors.status.danger,
  },
});
