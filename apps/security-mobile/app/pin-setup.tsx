import { unwrap } from '@safezone/api-client';
import { colors, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  BackRow,
  BigButton,
  BodyText,
  gateStyles,
  GateTitle,
  PinPad,
} from '../src/components/gate-ui';
import { errorText } from '../src/lib/errors';
import { useGate } from '../src/lib/gate';
import { api } from '../src/lib/session';

/** A guard sets their own 6-digit gate PIN from a full sign-in (ADR-0017 point 2): enter twice. */
export default function PinSetup() {
  const { estateId } = useGate();
  const queryClient = useQueryClient();
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await unwrap(
        api.PUT('/v1/estates/{estateId}/me/guard-pin', {
          params: { path: { estateId } },
          body: { pin: value },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'guard-pin'] });
      setSaved(true);
    } catch (caught) {
      setError(errorText(caught));
      setFirst(null);
    } finally {
      setBusy(false);
      setPin('');
    }
  };

  const onChange = (value: string) => {
    if (busy) return;
    setPin(value);
    if (value.length < 6) return;
    if (first === null) {
      setFirst(value);
      setPin('');
      setError(null);
    } else if (first !== value) {
      setError(t('sec.pinSetup.mismatch'));
      setFirst(null);
      setPin('');
    } else void save(value);
  };

  return (
    <SafeAreaView style={gateStyles.screen}>
      <ScrollView contentContainerStyle={gateStyles.content}>
        <BackRow onBack={() => router.back()} />
        <GateTitle>{t('sec.pinSetup.title')}</GateTitle>
        {saved ? (
          <View accessibilityLiveRegion="polite" style={{ gap: 16 }}>
            <BodyText>{t('sec.pinSetup.saved')}</BodyText>
            <BigButton label={t('sec.result.done')} onPress={() => router.back()} />
          </View>
        ) : (
          <>
            <BodyText muted>{t('sec.pinSetup.body')}</BodyText>
            <BodyText>
              {first === null ? t('sec.pinSetup.enter') : t('sec.pinSetup.confirm')}
            </BodyText>
            <PinPad value={pin} onChange={onChange} />
            {error ? (
              <Text
                accessibilityLiveRegion="assertive"
                style={{
                  color: colors.status.danger,
                  fontSize: typography.size.lg,
                  fontWeight: typography.weight.semibold,
                }}
              >
                {error}
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
