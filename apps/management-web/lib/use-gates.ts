'use client';

import { unwrap } from '@safezone/api-client';
import { useQuery } from '@tanstack/react-query';
import { useEstate } from './estate';
import { api } from './session';

/** Estate gates, plus a lookup from id to name for logs. */
export function useGates() {
  const { estateId, hasFeature } = useEstate();
  const query = useQuery({
    queryKey: ['estate', estateId, 'gates'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/gates', { params: { path: { estateId } } })),
    enabled: hasFeature('security'),
  });
  const names = new Map((query.data ?? []).map((gate) => [gate.id, gate.name]));
  return { gates: query.data ?? [], gateName: (id: string) => names.get(id) ?? '-' };
}
