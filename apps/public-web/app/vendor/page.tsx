import type { Metadata } from 'next';
import { RequireVendor } from '../../src/vendor/require';
import { OverviewScreen } from '../../src/vendor/overview-screen';

export const metadata: Metadata = { title: 'Overview' };

export default function Page() {
  return (
    <RequireVendor permission="vendor.order.work">
      <OverviewScreen />
    </RequireVendor>
  );
}
