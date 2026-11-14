import { redirect } from 'next/navigation';

export default async function EstateIndex({ params }: { params: Promise<{ estateId: string }> }) {
  const { estateId } = await params;
  redirect(`/${estateId}/dashboard`);
}
