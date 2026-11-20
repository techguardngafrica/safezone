import { Redirect } from 'expo-router';
import { lastPurchase } from '../../src/features/tokens';

/** safezone://utilities/return: back from checkout. The purchase screen verifies the payment. */
export default function TokenReturn() {
  const id = lastPurchase();
  return <Redirect href={id ? `/utilities/purchase/${id}` : '/utilities'} />;
}
