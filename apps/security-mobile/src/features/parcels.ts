import { unwrapPage } from '@safezone/api-client';
import { useQuery } from '@tanstack/react-query';
import { useGate } from '../lib/gate';
import { api } from '../lib/session';

/** Parcels waiting at the gate (security-mobile.md §7.4), refreshed every minute. */
export function useParcelsAtGate() {
  const { estateId } = useGate();
  return useQuery({
    queryKey: ['estate', estateId, 'deliveries', 'at_gate'],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/deliveries', {
          params: { path: { estateId }, query: { status: 'at_gate', limit: 100 } },
        }),
      ),
    refetchInterval: 60_000,
  });
}
