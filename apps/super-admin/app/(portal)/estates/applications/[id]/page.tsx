import { ApplicationReviewScreen } from '../../../../../src/features/estates/application-review-screen';

export default async function ApplicationReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ApplicationReviewScreen applicationId={id} />;
}
