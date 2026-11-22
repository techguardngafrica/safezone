import { Redirect } from 'expo-router';
import { rememberedCampaign } from '../../src/features/marketplace';

/** safezone://advertiser-mode/return: back from invoice checkout. The campaign screen verifies payment. */
export default function AdvertiserReturn() {
  const last = rememberedCampaign();
  return (
    <Redirect
      href={
        last
          ? {
              pathname: '/advertiser-mode/[id]',
              params: { id: last.campaignId, advertiserId: last.advertiserId },
            }
          : '/advertiser-mode'
      }
    />
  );
}
