import type { Metadata } from 'next';
import { RequireVendor } from '../../../src/vendor/require';
import { OrdersScreen } from '../../../src/vendor/orders-screen';

export const metadata: Metadata = { title: 'Orders' };

export default function Page() {
  return (
    <RequireVendor permission="vendor.order.work">
      <OrdersScreen />
    </RequireVendor>
  );
}
