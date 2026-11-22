import { Suspense } from 'react';
import { CreateEstateScreen } from '../../../../src/features/estates/create-estate-screen';

export default function CreateEstatePage() {
  return (
    <Suspense>
      <CreateEstateScreen />
    </Suspense>
  );
}
