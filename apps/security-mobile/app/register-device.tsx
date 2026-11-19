import { unwrap } from '@safezone/api-client';
import { colors, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { ScrollScreen, TextField } from '@safezone/mobile-ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { BackRow, BigButton, BodyText, GateTitle } from '../src/components/gate-ui';
import { gateDevice } from '../src/lib/device';
import { errorText } from '../src/lib/errors';
import { useGate } from '../src/lib/gate';
import { api, session } from '../src/lib/session';

/**
 * A supervisor registers this phone as the gate device (ADR-0017 point 1). The API ends the
 * supervisor's own session; the app keeps only the device credential, then shows the guard list.
 */
export default function RegisterDevice() {
  const { estateId, estateName, gate } = useGate();
  const [name, setName] = useState(gate ? `${gate.name} phone` : '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const register = async () => {
    if (!gate) return;
    if (name.trim().length < 2) {
      setNameError(t('sec.device.nameRequired'));
      return;
    }
    setNameError(null);
    setBusy(true);
    setError(null);
    try {
      const result = await unwrap(
        api.POST('/v1/estates/{estateId}/gate-devices', {
          params: { path: { estateId } },
          body: { gateId: gate.id, name: name.trim() },
        }),
      );
      await gateDevice.save({
        credential: result.credential,
        deviceId: result.device.id,
        deviceName: result.device.name,
        estateId,
        estateName,
        gateId: gate.id,
        gateName: gate.name,
      });
      // The server already ended this session; clear it here too.
      await session.signOut();
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
          label={t('sec.device.registerSubmit')}
          icon="phone-portrait-outline"
          busy={busy}
          onPress={() => void register()}
        />
      }
    >
      <BackRow onBack={() => router.back()} />
      <GateTitle>{t('sec.device.registerTitle')}</GateTitle>
      <BodyText>{t('sec.device.registerBody')}</BodyText>
      <BodyText muted>
        {t('sec.guard.subtitle', { gate: gate?.name ?? '', estate: estateName })}
      </BodyText>
      <TextField
        label={t('sec.device.nameLabel')}
        value={name}
        onChangeText={setName}
        placeholder={t('sec.device.namePlaceholder')}
        maxLength={60}
        error={nameError}
      />
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{
            color: colors.status.danger,
            fontSize: typography.size.lg,
            fontWeight: typography.weight.semibold,
          }}
        >
          {error}
        </Text>
      ) : null}
    </ScrollScreen>
  );
}
