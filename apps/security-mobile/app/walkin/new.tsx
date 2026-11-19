import { unwrap } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { ScrollScreen, TextField } from '@safezone/mobile-ui';
import { normalizeNigerianPhone } from '@safezone/schemas';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BackRow, BigButton, BodyText, GateTitle } from '../../src/components/gate-ui';
import { PickedUnit, type Unit, UnitPicker } from '../../src/components/unit-picker';
import { errorText } from '../../src/lib/errors';
import { useGate } from '../../src/lib/gate';
import { api } from '../../src/lib/session';

/** Walk-in visitor (security-mobile.md §7.3): asks the household, then waits for their answer. */
export default function NewWalkin() {
  const { estateId, gate, sync } = useGate();
  // A delivery rider who must come in arrives here prefilled from the delivery form.
  const prefill = useLocalSearchParams<{ name?: string; purpose?: string; plate?: string }>();
  const [name, setName] = useState(prefill.name ?? '');
  const [phone, setPhone] = useState('');
  const [purpose, setPurpose] = useState(prefill.purpose ?? '');
  const [plate, setPlate] = useState(prefill.plate ?? '');
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
        <PickedUnit unit={unit} onChange={() => setUnit(null)} />
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
