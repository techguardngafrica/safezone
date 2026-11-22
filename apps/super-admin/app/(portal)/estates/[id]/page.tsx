import { EstateDetailScreen } from '../../../../src/features/estates/estate-detail-screen';

export default async function EstateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EstateDetailScreen estateId={id} />;
}
