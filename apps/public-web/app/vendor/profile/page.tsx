import type { Metadata } from 'next';
import { RequireVendor } from '../../../src/vendor/require';
import { ProfileScreen } from '../../../src/vendor/profile-screen';

export const metadata: Metadata = { title: 'Profile and payout' };

export default function Page() {
  return (
    <RequireVendor permission="vendor.profile.manage">
      <ProfileScreen />
    </RequireVendor>
  );
}
