import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CampaignDetailScreen } from '../../../../src/advertiser/campaign-detail-screen';

export const metadata: Metadata = { title: 'Campaign' };

export default async function AdvertiserCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense>
      <CampaignDetailScreen id={id} />
    </Suspense>
  );
}
