import { newIdempotencyKey, unwrap } from '@safezone/api-client';
import { useMutation } from '@tanstack/react-query';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useRouter } from 'expo-router';
import { useRef } from 'react';
import { Linking } from 'react-native';
import { useResident } from '../lib/resident';
import { api } from '../lib/session';
import { rememberIntent } from './bills';
import { type PayChoice, payFields } from './pay-choice';

/** Expo Go cannot receive safezone:// links; installed builds return to the app after checkout. */
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/**
 * Starts checkout for some or all open bills: the API computes the amount, the payment screen opens,
 * then the provider's checkout. Success is only ever shown after the API verifies the payment.
 */
export function useStartPayment() {
  const router = useRouter();
  const { estateId } = useResident();
  const key = useRef(newIdempotencyKey());
  return useMutation({
    mutationFn: ({ invoiceIds, choice }: { invoiceIds?: string[]; choice?: PayChoice }) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/payment-intents', {
          params: { path: { estateId } },
          headers: { 'Idempotency-Key': key.current },
          body: {
            ...(invoiceIds ? { invoiceIds } : {}),
            ...(choice ? payFields(choice) : {}),
            ...(inExpoGo ? {} : { callbackUrl: 'safezone://pay/return' }),
          },
        }),
      ),
    onSuccess: (intent) => {
      key.current = newIdempotencyKey();
      rememberIntent(intent.id);
      router.push(`/pay/${intent.id}`);
      if (intent.authorizationUrl) void Linking.openURL(intent.authorizationUrl);
    },
    onError: () => {
      key.current = newIdempotencyKey();
    },
  });
}
