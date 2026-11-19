import { unwrap } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { ScrollScreen, TextField } from '@safezone/mobile-ui';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BackRow, BigButton, BodyText, GateTitle } from '../src/components/gate-ui';
import { PickedUnit, type Unit, UnitPicker } from '../src/components/unit-picker';
import { errorText } from '../src/lib/errors';
import { useGate } from '../src/lib/gate';
import { api } from '../src/lib/session';

/**
 * Delivery at the gate (security-mobile.md §7.4): log the parcel and tell the household ("drop at gate"),
 * or send the rider through the walk-in approval. Residents' delivery passes are scanned as usual.
 */
export default function DeliveryScreen() {
  const { estateId, gate, sync } = useGate();
  const queryClient = useQueryClient();
  const [company, setCompany] = useState('');
  const [rider, setRider] = useState('');
  const [plate, setPlate] = useState('');
  const [note, setNote] = useState('');
  const [unit, setUnit] = useState<Unit | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (company.trim().length < 2) next.company = t('sec.delivery.companyRequired');
    if (!unit) next.unit = t('sec.delivery.unitRequired');
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const drop = async () => {
    if (!validate() || !unit || !gate) return;
    setBusy(true);
    setError(null);
    try {
      await unwrap(
        api.POST('/v1/estates/{estateId}/deliveries', {
          params: { path: { estateId } },
          body: {
            gateId: gate.id,
            spaceId: unit.id,
            company: company.trim(),
            ...(rider.trim().length >= 2 ? { riderName: rider.trim() } : {}),
            ...(plate.trim().length >= 3 ? { vehiclePlate: plate.trim().toUpperCase() } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
          },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'deliveries'] });
      setDone(true);
      setTimeout(() => router.dismissTo('/'), 2000);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const letIn = () => {
    if (!validate() || !unit) return;
    router.replace({
      pathname: '/walkin/new',
      params: {
        name: rider.trim() || company.trim(),
        purpose: t('sec.delivery.walkinPurpose', { company: company.trim() }),
        plate: plate.trim(),
      },
    });
  };

  if (done)
    return (
      <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
        <View accessibilityLiveRegion="polite" style={{ gap: spacing[4] }}>
          <GateTitle>{t('sec.delivery.title')}</GateTitle>
          <BodyText>{t('sec.delivery.dropped')}</BodyText>
          <BigButton label={t('sec.result.done')} onPress={() => router.dismissTo('/')} />
        </View>
      </ScrollScreen>
    );

  return (
    <ScrollScreen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        <View style={{ gap: spacing[2] }}>
          <BigButton
            label={t('sec.delivery.drop')}
            icon="cube-outline"
            busy={busy}
            disabled={!sync.online}
            onPress={() => void drop()}
          />
          <BigButton
            label={t('sec.delivery.letIn')}
            tone="outline"
            icon="enter-outline"
            disabled={busy || !sync.online}
            onPress={letIn}
          />
        </View>
      }
    >
      <BackRow onBack={() => router.back()} />
      <GateTitle>{t('sec.delivery.title')}</GateTitle>
      {sync.online ? (
        <BodyText muted>{t('sec.delivery.body')}</BodyText>
      ) : (
        <View style={styles.offline} accessibilityLiveRegion="polite">
          <BodyText>{t('sec.delivery.offline')}</BodyText>
        </View>
      )}
      <TextField
        label={t('sec.delivery.company')}
        value={company}
        onChangeText={setCompany}
        placeholder={t('sec.delivery.companyPlaceholder')}
        autoCapitalize="words"
        maxLength={80}
        error={errors.company}
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
        label={t('sec.delivery.rider')}
        value={rider}
        onChangeText={setRider}
        autoCapitalize="words"
        maxLength={120}
      />
      <TextField
        label={t('sec.delivery.plate')}
        value={plate}
        onChangeText={setPlate}
        autoCapitalize="characters"
        maxLength={15}
      />
      <TextField
        label={t('sec.delivery.note')}
        value={note}
        onChangeText={setNote}
        placeholder={t('sec.delivery.notePlaceholder')}
        maxLength={300}
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
