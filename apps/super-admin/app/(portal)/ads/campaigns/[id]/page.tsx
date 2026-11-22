import { CampaignDetailScreen } from '../../../../../src/features/ads/campaign-detail-screen';

export default async function AdCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignDetailScreen id={id} />;
}
