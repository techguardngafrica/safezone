import { unwrap } from '@safezone/api-client';
import { useQuery } from '@tanstack/react-query';
import { useGate } from '../lib/gate';
import { api } from '../lib/session';

/** My open shift, the last handover at this gate, and my open incidents (security-mobile.md §7.8). */
export function useCurrentShift() {
  const { estateId, gate, hasFeature } = useGate();
  const gateId = gate?.id ?? '';
  return useQuery({
    queryKey: ['estate', estateId, 'shift', 'current', gateId],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/shift-sessions/current', {
          params: { path: { estateId }, query: { gateId } },
        }),
      ),
    enabled: Boolean(estateId && gateId) && hasFeature('security'),
    refetchInterval: 60_000,
  });
}
