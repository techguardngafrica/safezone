import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import { CheckboxRow, ChipGroup } from '@safezone/mobile-ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { marketStyles } from './market-text';
import { api } from '../lib/session';

/** How the resident pays (ADR-0025): a saved card, or checkout with the option to save the card. */
export interface PayChoice {
  paymentMethodId?: string;
  saveCard: boolean;
}

/** The body fields a payment endpoint takes for this choice. */
export function payFields(choice: PayChoice): { paymentMethodId?: string; saveCard?: boolean } {
  return choice.paymentMethodId
    ? { paymentMethodId: choice.paymentMethodId }
    : choice.saveCard
      ? { saveCard: true }
      : {};
}

/** Saved cards first (most recently used is the default), then checkout. */
export function usePayChoice() {
  const cards = useQuery({
    queryKey: ['me', 'payment-methods'],
    queryFn: () => unwrap(api.GET('/v1/me/payment-methods')),
  });
  const [choice, setChoice] = useState<PayChoice>({ saveCard: false });
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    const first = cards.data?.[0];
    if (!touched && first) setChoice({ paymentMethodId: first.id, saveCard: false });
  }, [cards.data, touched]);

  const element = (
    <View style={{ gap: 8 }}>
      {cards.data && cards.data.length > 0 ? (
        <ChipGroup
          label={t('res.wallet.payWith')}
          value={choice.paymentMethodId ?? 'checkout'}
          onChange={(key) => {
            setTouched(true);
            setChoice(
              key === 'checkout' ? { saveCard: false } : { paymentMethodId: key, saveCard: false },
            );
          }}
          options={[
            ...cards.data.map((card) => ({
              key: card.id,
              label: t('res.wallet.cardLabel', {
                brand: card.brand.toUpperCase(),
                last4: card.last4,
              }),
            })),
            { key: 'checkout', label: t('res.wallet.newCard') },
          ]}
        />
      ) : null}
      {!choice.paymentMethodId ? (
        <>
          <CheckboxRow
            label={t('res.wallet.saveCard')}
            checked={choice.saveCard}
            onChange={(saveCard) => {
              setTouched(true);
              setChoice({ saveCard });
            }}
          />
          <Text style={marketStyles.muted}>{t('res.wallet.saveCardHint')}</Text>
        </>
      ) : null}
    </View>
  );
  return { choice, element };
}
