import { colors, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { Segmented } from '@safezone/mobile-ui';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  BackRow,
  BigButton,
  BodyText,
  gateStyles,
  GateTitle,
  PinPad,
} from '../src/components/gate-ui';
import { useCheck } from '../src/features/use-check';

/** 6-digit PIN check on a large keypad (works with gloves). */
export default function PinScreen() {
  const [pin, setPin] = useState('');
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const { check, busy, error } = useCheck(direction);

  useFocusEffect(useCallback(() => setPin(''), []));

  const onChange = (value: string) => {
    setPin(value);
    if (value.length === 6) void check({ pin: value });
  };

  return (
    <SafeAreaView style={gateStyles.screen}>
      <ScrollView contentContainerStyle={gateStyles.content}>
        <BackRow onBack={() => router.back()} />
        <GateTitle>{t('sec.pin.title')}</GateTitle>
        <Segmented
          label={t('sec.direction.label')}
          value={direction}
          onChange={setDirection}
          options={[
            { key: 'in', label: t('sec.direction.in') },
            { key: 'out', label: t('sec.direction.out') },
          ]}
        />
        <BodyText muted>{t('sec.pin.hint')}</BodyText>
        <PinPad value={pin} onChange={onChange} />
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
        <BigButton
          label={t('sec.pin.check')}
          icon="checkmark-circle-outline"
          disabled={pin.length !== 6}
          busy={busy}
          onPress={() => void check({ pin })}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
