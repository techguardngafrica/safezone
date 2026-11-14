import { colors } from '@safezone/design-tokens';
import { Card, StatusPill } from '@safezone/mobile-ui';
import { Text, View } from 'react-native';
import { PASS_TONE, type Pass, passStatusLabel, passTypeLabel, passWindow } from './passes';

export function PassCard({ pass, onPress }: { pass: Pass; onPress: () => void }) {
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${pass.visitorName}, ${passStatusLabel(pass.status)}`}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: colors.semantic.text, flex: 1 }}>
          {pass.visitorName}
        </Text>
        <StatusPill tone={PASS_TONE[pass.status]} label={passStatusLabel(pass.status)} />
      </View>
      <Text style={{ color: colors.semantic.textMuted, fontSize: 14 }}>
        {passTypeLabel(pass.type)}
        {pass.vehiclePlate ? ` · ${pass.vehiclePlate}` : ''}
      </Text>
      <Text style={{ color: colors.semantic.text, fontSize: 14 }}>{passWindow(pass)}</Text>
    </Card>
  );
}
