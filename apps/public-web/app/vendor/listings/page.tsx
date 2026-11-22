import type { Metadata } from 'next';
import { RequireVendor } from '../../../src/vendor/require';
import { ListingsScreen } from '../../../src/vendor/listings-screen';

export const metadata: Metadata = { title: 'Listings' };

export default function Page() {
  return (
    <RequireVendor permission="vendor.listing.manage">
      <ListingsScreen />
    </RequireVendor>
  );
}
