import { Redirect } from 'expo-router';
import { lastOrder } from '../../src/features/marketplace';

/** safezone://marketplace/return: back from checkout. The order screen verifies the payment. */
export default function MarketplaceReturn() {
  const id = lastOrder();
  return <Redirect href={id ? `/marketplace/orders/${id}` : '/marketplace/orders'} />;
}
