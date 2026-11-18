import { colors } from '@safezone/design-tokens';
import { formatDate, formatKobo, t } from '@safezone/i18n';
import { Card, StatusPill } from '@safezone/mobile-ui';
import { Text, View } from 'react-native';
import { type Invoice, invoiceState, isOpenInvoice } from './bills';

export function InvoiceCard({ invoice, onPress }: { invoice: Invoice; onPress: () => void }) {
  const state = invoiceState(invoice);
  const open = isOpenInvoice(invoice);
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${invoice.description}, ${formatKobo(open ? invoice.balance : invoice.total)}, ${state.label}`}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: colors.semantic.text, flex: 1 }}>
          {invoice.description}
        </Text>
        <Text
          style={{
            fontSize: 16,
            fontWeight: '700',
            color: colors.semantic.text,
            fontVariant: ['tabular-nums'],
          }}
        >
          {formatKobo(open ? invoice.balance : invoice.total)}
        </Text>
      </View>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Text style={{ color: colors.semantic.textMuted, fontSize: 14 }}>
          {invoice.number} ·{' '}
          {t('res.bills.due', { date: formatDate(`${invoice.dueDate}T12:00:00Z`) })}
        </Text>
        <StatusPill tone={state.tone} label={state.label} />
      </View>
    </Card>
  );
}
