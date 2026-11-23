import { DisputesScreen } from '../../../src/vendor/disputes-screen';
import { RequireVendor } from '../../../src/vendor/require';

export default function VendorDisputesPage() {
  return (
    <RequireVendor permission="vendor.order.manage">
      <DisputesScreen />
    </RequireVendor>
  );
}
