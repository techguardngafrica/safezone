import { VendorDetailScreen } from '../../../../src/features/vendors/vendor-detail-screen';

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VendorDetailScreen id={id} />;
}
