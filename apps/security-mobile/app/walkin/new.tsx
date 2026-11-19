import { type ApiRow, unwrap, unwrapPage } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { ScrollScreen, Skeleton, TextField } from '@safezone/mobile-ui';
import { normalizeNigerianPhone } from '@safezone/schemas';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BackRow, BigButton, BodyText, GateTitle } from '../../src/components/gate-ui';
import { errorText } from '../../src/lib/errors';
import { useGate } from '../../src/lib/gate';
import { api } from '../../src/lib/session';

type Unit = ApiRow<'/v1/estates/{estateId}/units', 'get'>;

function useDebounced(value: string, ms = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [ms, value]);
  return debounced;
}

function UnitPicker({ onPick }: { onPick: (unit: Unit) => void }) {
  const { estateId } = useGate();
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim());
  const units = useQuery({
    queryKey: ['estate', estateId, 'units', 'search', q],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/units', {
          params: { path: { estateId }, query: { q, limit: 8 } },
        }),
      ),
    enabled: q.length >= 1,
  });
  return (
    <View style={{ gap: spacing[2] }}>
      <TextField
        label={t('sec.walkin.unit')}
        value={query}
        onChangeText={setQuery}
        placeholder={t('sec.walkin.unitSearch')}
        autoCapitalize="characters"
      />
      {units.isFetching && !units.data ? <Skeleton height={56} /> : null}
      {units.data?.items.map((unit) => (
        <Pressable
          key={unit.id}
          accessibilityRole="button"
          accessibilityLabel={`${unit.code}, ${unit.name}`}
          onPress={() => onPick(unit)}
          style={({ pressed }) => [styles.unit, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.unitCode}>{unit.code}</Text>
          <Text style={styles.unitName}>{unit.name}</Text>
        </Pressable>
      ))}
      {units.data && units.data.items.length === 0 ? (
        <BodyText muted>{t('sec.walkin.unitNone', { query: q })}</BodyText>
      ) : null}
      {units.isError ? <Text style={styles.error}>{errorText(units.error)}</Text> : null}
    </View>
  );
}

/** Walk-in visitor (security-mobile.md §7.3): asks the household, then waits for their answer. */
export default function NewWalkin() {
  const { estateId, gate, sync } = useGate();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [purpose, setPurpose] = useState('');
  const [plate, setPlate] = useState('');
  const [unit, setUnit] = useState<Unit | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = t('sec.walkin.nameRequired');
    if (!unit) next.unit = t('sec.walkin.unitRequired');
    const e164 = phone.trim() ? normalizeNigerianPhone(phone) : null;
    if (phone.trim() && !e164) next.phone = t('sec.walkin.phoneInvalid');
    setErrors(next);
    if (Object.keys(next).length > 0 || !unit || !gate) return;
    setBusy(true);
    setError(null);
    try {
      const walkin = await unwrap(
        api.POST('/v1/estates/{estateId}/walkins', {
          params: { path: { estateId } },
          body: {
            gateId: gate.id,
            spaceId: unit.id,
            visitorName: name.trim(),
            ...(e164 ? { visitorPhone: e164 } : {}),
            ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
            ...(plate.trim().length >= 3 ? { vehiclePlate: plate.trim().toUpperCase() } : {}),
          },
        }),
      );
      router.replace(`/walkin/${walkin.id}`);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollScreen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        <BigButton
          label={t('sec.walkin.send')}
          icon="send-outline"
          busy={busy}
          disabled={!sync.online}
          onPress={() => void submit()}
        />
      }
    >
      <BackRow onBack={() => router.back()} />
      <GateTitle>{t('sec.walkin.title')}</GateTitle>
      {sync.online ? (
        <BodyText muted>{t('sec.walkin.body')}</BodyText>
      ) : (
        <View style={styles.offline} accessibilityLiveRegion="polite">
          <BodyText>{t('sec.walkin.offline')}</BodyText>
        </View>
      )}
      <TextField
        label={t('sec.walkin.name')}
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        maxLength={120}
        error={errors.name}
      />
      {unit ? (
        <View style={styles.picked}>
          <View style={{ flex: 1 }}>
            <Text style={styles.unitCode}>{unit.code}</Text>
            <Text style={styles.unitName}>{unit.name}</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => setUnit(null)} style={styles.change}>
            <Text style={styles.changeText}>{t('sec.walkin.unitChange')}</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <UnitPicker onPick={setUnit} />
          {errors.unit ? <Text style={styles.error}>{errors.unit}</Text> : null}
        </>
      )}
      <TextField
        label={t('sec.walkin.purpose')}
        value={purpose}
        onChangeText={setPurpose}
        placeholder={t('sec.walkin.purposePlaceholder')}
        maxLength={200}
      />
      <TextField
        label={t('sec.walkin.plate')}
        value={plate}
        onChangeText={setPlate}
        autoCapitalize="characters"
        maxLength={15}
      />
      <TextField
        label={t('sec.walkin.phone')}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        maxLength={16}
        error={errors.phone}
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  unit: {
    minHeight: 64,
    padding: spacing[3],
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.semantic.border,
    backgroundColor: colors.neutral[0],
    justifyContent: 'center',
  },
  picked: {
    minHeight: 72,
    padding: spacing[3],
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.brand.primary,
    backgroundColor: colors.neutral[0],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  unitCode: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  unitName: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
    color: colors.semantic.textMuted,
  },
  change: { minHeight: 56, justifyContent: 'center', paddingHorizontal: spacing[2] },
  changeText: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    color: colors.brand.primary,
  },
  offline: {
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.status.warning,
    padding: spacing[3],
  },
  error: {
    color: colors.status.danger,
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
  },
});
