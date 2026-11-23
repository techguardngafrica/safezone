import type { Metadata } from 'next';
import { t } from '@safezone/i18n';
import { PageTitle } from '../../../../../src/components/site-shell';
import { EnquiryStatusScreen } from '../../../../../src/advertise/enquiry-status-screen';

export const metadata: Metadata = {
  title: t('public.advertise.status.metaTitle'),
  robots: { index: false, follow: false },
};

/** Link-based advertising enquiry status page (public-web.md §7). No indexing. */
export default async function AdvertiseEnquiryStatusPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <>
      <PageTitle
        title={t('public.advertise.status.title')}
        lead={t('public.advertise.status.lead')}
      />
      <EnquiryStatusScreen token={token} />
    </>
  );
}
