import { Suspense } from 'react';
import { CampaignsScreen } from '../../../../src/features/ads/campaigns-screen';

export default function AdCampaignsPage() {
  return (
    <Suspense>
      <CampaignsScreen />
    </Suspense>
  );
}
