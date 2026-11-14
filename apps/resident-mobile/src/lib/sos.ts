import { unwrap } from '@safezone/api-client';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@safezone/mobile-ui';
import { useResident } from './resident';
import { api, session } from './session';

/** The signed-in resident's own active SOS, if any, so the SOS control reopens it instead of sending another. */
export function useMyActiveSos() {
  const { estateId, hasFeature } = useResident();
  const me = useSession(session).user?.id;
  const active = useQuery({
    queryKey: ['estate', estateId, 'sos', 'active'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/sos', {
          params: { path: { estateId }, query: { status: 'active' } },
        }),
      ),
    enabled: Boolean(estateId) && hasFeature('emergency'),
    refetchInterval: 15_000,
  });
  return active.data?.find((alert) => alert.triggeredBy === me) ?? null;
}
