import type { Metadata } from 'next';
import { RequireVendor } from '../../../src/vendor/require';
import { EarningsScreen } from '../../../src/vendor/earnings-screen';

export const metadata: Metadata = { title: 'Earnings and reviews' };

export default function Page() {
  return (
    <RequireVendor permission="vendor.payout.read">
      <EarningsScreen />
    </RequireVendor>
  );
}
