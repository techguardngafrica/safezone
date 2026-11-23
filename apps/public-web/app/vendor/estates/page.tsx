import { EstatesScreen } from '../../../src/vendor/estates-screen';
import { RequireVendor } from '../../../src/vendor/require';

export default function VendorEstatesPage() {
  return (
    <RequireVendor permission="vendor.order.manage">
      <EstatesScreen />
    </RequireVendor>
  );
}
