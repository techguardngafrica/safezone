import type { Metadata } from 'next';
import { TeamScreen } from '../../../src/advertiser/team-screen';

export const metadata: Metadata = { title: 'Team' };

export default function AdvertiserTeamPage() {
  return <TeamScreen />;
}
