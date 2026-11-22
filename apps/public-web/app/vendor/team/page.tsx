import type { Metadata } from 'next';
import { RequireVendor } from '../../../src/vendor/require';
import { TeamScreen } from '../../../src/vendor/team-screen';

export const metadata: Metadata = { title: 'Team' };

export default function Page() {
  return (
    <RequireVendor permission="vendor.team.manage">
      <TeamScreen />
    </RequireVendor>
  );
}
