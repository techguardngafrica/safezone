import { newIdempotencyKey, unwrap } from '@safezone/api-client';
import { colors, spacing, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { ConfirmModal } from '@safezone/mobile-ui';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackRow, BigButton, BodyText, gateStyles, GateTitle } from '../../src/components/gate-ui';
import { categoryText } from '../../src/features/sos';
import { errorText, isNetworkError } from '../../src/lib/errors';
import { useGate } from '../../src/lib/gate';
import { api } from '../../src/lib/session';

const CATEGORIES = [
  'security_threat',
  'suspicious_activity',
  'medical',
  'fire',
  'accident',
  'general',
] as const;
type Category = (typeof CATEGORIES)[number];

/** A guard raises an SOS (e.g. an attack at the gate). One Idempotency-Key per confirmed press. */
export default function RaiseSos() {
  const { estateId } = useGate();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const key = useRef<string | null>(null);

  const send = async () => {
    if (!category) return;
    key.current ??= newIdempotencyKey();
    setBusy(true);
    setError(null);
    try {
      const alert = await unwrap(
        api.POST('/v1/estates/{estateId}/sos', {
          params: { path: { estateId } },
          headers: { 'Idempotency-Key': key.current },
          body: { category, isDrill: false },
        }),
      );
      key.current = null;
      await queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'sos', 'active'] });
      setCategory(null);
      router.replace(`/sos/${alert.id}`);
    } catch (caught) {
      // Keep the same key so a retry cannot raise a second alert.
      if (isNetworkError(caught)) setOffline(true);
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={gateStyles.screen}>
      <ScrollView contentContainerStyle={gateStyles.content}>
        <BackRow onBack={() => router.back()} />
        <GateTitle>{t('sec.sos.raiseTitle')}</GateTitle>
        <BodyText>{t('sec.sos.raiseBody')}</BodyText>
        <BodyText muted>{t('sec.sos.category')}</BodyText>
        {CATEGORIES.map((item) => (
          <BigButton
            key={item}
            label={categoryText(item)}
            tone="danger"
            icon="warning-outline"
            onPress={() => {
              setError(null);
              setCategory(item);
            }}
          />
        ))}
        {offline ? (
          <Text
            accessibilityLiveRegion="assertive"
            style={{
              color: colors.status.danger,
              fontSize: typography.size.lg,
              fontWeight: typography.weight.semibold,
              marginTop: spacing[2],
            }}
          >
            {t('sec.sos.offline')}
          </Text>
        ) : null}
      </ScrollView>
      <ConfirmModal
        visible={category !== null}
        title={t('sec.sos.raiseConfirmTitle')}
        body={`${category ? categoryText(category) : ''}. ${t('sec.sos.raiseConfirmBody')}`}
        confirmLabel={t('sec.sos.raise')}
        destructive
        busy={busy}
        error={error}
        onConfirm={() => void send()}
        onCancel={() => setCategory(null)}
      />
    </SafeAreaView>
  );
}
