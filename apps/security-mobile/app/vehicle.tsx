import { type ApiData, unwrap } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { ConfirmModal, ScrollScreen, Segmented, TextField } from '@safezone/mobile-ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BackRow, BigButton, BodyText, Fact, GateTitle } from '../src/components/gate-ui';
import { setVerification } from '../src/features/verification';
import { errorText, isNetworkError } from '../src/lib/errors';
import { useGate } from '../src/lib/gate';
import { api } from '../src/lib/session';
import { normalisePlate } from '../src/offline/decide';
import { verifyListed, type ExpectedPass } from '../src/offline/verify';

type Resident = NonNullable<ApiData<'/v1/estates/{estateId}/vehicles/lookup', 'get'>>;

interface Outcome {
  plate: string;
  resident: Resident | null;
  visitors: ExpectedPass[];
  restricted: boolean;
  offline: boolean;
}

/** Plate check (security-mobile.md §7.5): resident vehicles and visitor vehicles expected today. */
export default function VehicleScreen() {
  const { estateId, sync } = useGate();
  const [plate, setPlate] = useState('');
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');

  const search = async () => {
    const wanted = normalisePlate(plate);
    if (wanted.length < 3) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const visitors = (sync.expected?.passes ?? []).filter(
      (pass) => pass.vehiclePlate !== null && normalisePlate(pass.vehiclePlate) === wanted,
    );
    const restricted = (sync.expected?.restricted ?? []).some(
      (item) => item.plate !== null && normalisePlate(item.plate) === wanted,
    );
    try {
      const resident = await unwrap(
        api.GET('/v1/estates/{estateId}/vehicles/lookup', {
          params: { path: { estateId }, query: { plate: plate.trim() } },
        }),
      );
      setOutcome({
        plate: plate.trim().toUpperCase(),
        resident,
        visitors,
        restricted,
        offline: false,
      });
    } catch (caught) {
      if (isNetworkError(caught))
        setOutcome({
          plate: plate.trim().toUpperCase(),
          resident: null,
          visitors,
          restricted,
          offline: true,
        });
      else setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const record = async (decision: 'allow' | 'check', why?: string) => {
    if (!outcome) return;
    setBusy(true);
    setError(null);
    try {
      const result = await sync.record({
        direction,
        vehiclePlate: outcome.plate,
        decision,
        reason: why?.trim() || undefined,
      });
      setAsking(false);
      const text = direction === 'out' ? t('sec.result.exitRecorded') : t('sec.result.recorded');
      setMessage(result.queued ? `${text} ${t('sec.result.queued')}` : text);
      setOutcome(null);
      setPlate('');
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const checkVisitor = (pass: ExpectedPass) => {
    if (!sync.cache) return;
    setVerification({
      result: verifyListed(sync.cache, pass.id, direction),
      direction,
      checkedAt: Date.now(),
    });
    router.push('/result');
  };

  const unknown =
    outcome !== null && !outcome.resident && outcome.visitors.length === 0 && !outcome.restricted;

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
      <BackRow onBack={() => router.back()} />
      <GateTitle>{t('sec.vehicle.title')}</GateTitle>
      <Segmented
        label={t('sec.direction.label')}
        value={direction}
        onChange={setDirection}
        options={[
          { key: 'in', label: t('sec.direction.in') },
          { key: 'out', label: t('sec.direction.out') },
        ]}
      />
      <TextField
        label={t('sec.vehicle.plate')}
        value={plate}
        onChangeText={(value) => {
          setPlate(value);
          setOutcome(null);
        }}
        autoCapitalize="characters"
        maxLength={15}
      />
      <BigButton
        label={t('sec.vehicle.search')}
        icon="search-outline"
        busy={busy && !outcome}
        disabled={normalisePlate(plate).length < 3}
        onPress={() => void search()}
      />
      {message ? (
        <View accessibilityLiveRegion="polite">
          <BodyText>{message}</BodyText>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {outcome ? (
        <View style={{ gap: spacing[3] }} accessibilityLiveRegion="polite">
          {outcome.offline ? <BodyText muted>{t('sec.vehicle.offlineLookup')}</BodyText> : null}
          {outcome.restricted ? (
            <View style={[styles.card, { borderColor: colors.gate.deny }]}>
              <Text style={[styles.word, { color: colors.gate.deny }]}>{t('gate.deny')}</Text>
              <BodyText>{t('sec.vehicle.restricted')}</BodyText>
            </View>
          ) : null}
          {outcome.resident ? (
            <View style={[styles.card, { borderColor: colors.gate.allow }]}>
              <Text style={styles.cardTitle}>{t('sec.vehicle.resident')}</Text>
              <Fact label={t('sec.result.host')} value={outcome.resident.unitCode} />
              <Fact label={t('sec.vehicle.household')} value={outcome.resident.householdName} />
              {[outcome.resident.colour, outcome.resident.make, outcome.resident.model].some(
                Boolean,
              ) ? (
                <Fact
                  label={t('sec.result.vehicle')}
                  value={[outcome.resident.colour, outcome.resident.make, outcome.resident.model]
                    .filter(Boolean)
                    .join(' ')}
                />
              ) : null}
              {!outcome.restricted ? (
                <BigButton
                  label={
                    direction === 'out' ? t('sec.vehicle.recordOut') : t('sec.vehicle.recordIn')
                  }
                  icon={direction === 'out' ? 'exit-outline' : 'enter-outline'}
                  busy={busy}
                  onPress={() => void record('allow')}
                />
              ) : null}
            </View>
          ) : null}
          {outcome.visitors.map((pass) => (
            <View key={pass.id} style={[styles.card, { borderColor: colors.brand.primary }]}>
              <Text style={styles.cardTitle}>{t('sec.vehicle.visitor')}</Text>
              <Fact label={t('sec.walkin.name')} value={pass.visitorName} />
              {pass.unitCode ? <Fact label={t('sec.result.host')} value={pass.unitCode} /> : null}
              <BigButton
                label={t('sec.expected.check')}
                icon="shield-checkmark-outline"
                onPress={() => checkVisitor(pass)}
              />
            </View>
          ))}
          {unknown ? (
            <View style={[styles.card, { borderColor: colors.gate.check }]}>
              <Text style={[styles.word, { color: colors.gate.check }]}>{t('gate.check')}</Text>
              <BodyText>{t('sec.vehicle.none')}</BodyText>
              <BigButton
                label={
                  direction === 'out'
                    ? t('sec.vehicle.recordOut')
                    : t('sec.result.recordWithReason')
                }
                tone="outline"
                onPress={() => {
                  if (direction === 'out') void record('allow');
                  else {
                    setReason('');
                    setAsking(true);
                  }
                }}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      <ConfirmModal
        visible={asking}
        title={t('sec.vehicle.unregistered')}
        body={t('sec.result.overrideBody')}
        confirmLabel={t('sec.vehicle.recordIn')}
        busy={busy}
        error={error}
        reason={{
          label: t('sec.vehicle.reasonLabel'),
          value: reason,
          onChange: setReason,
          required: true,
        }}
        onConfirm={() => void record('check', reason)}
        onCancel={() => setAsking(false)}
      />
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radii.lg,
    borderWidth: 3,
    backgroundColor: colors.neutral[0],
  },
  cardTitle: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  word: { fontSize: typography.size.xxl, fontWeight: typography.weight.bold, letterSpacing: 1 },
  error: {
    color: colors.status.danger,
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
  },
});
