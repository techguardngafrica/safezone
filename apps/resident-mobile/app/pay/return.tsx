import { Redirect } from 'expo-router';
import { lastIntent } from '../../src/features/bills';

/** safezone://pay/return: back from checkout in an installed build. The payment screen verifies it. */
export default function PaymentReturn() {
  const id = lastIntent();
  return <Redirect href={id ? `/pay/${id}` : '/pay'} />;
}
