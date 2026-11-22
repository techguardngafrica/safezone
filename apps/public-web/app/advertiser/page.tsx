import type { Metadata } from 'next';
import { CampaignsScreen } from '../../src/advertiser/campaigns-screen';

export const metadata: Metadata = { title: 'Campaigns' };

export default function AdvertiserHome() {
  return <CampaignsScreen />;
}
