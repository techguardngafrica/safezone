import { unwrap } from '@safezone/api-client';
import { useQuery } from '@tanstack/react-query';
import { useResident } from '../lib/resident';
import { api } from '../lib/session';

/** The estate's community guidelines and whether this member has agreed to them. */
export function useGuidelines() {
  const { estateId } = useResident();
  return useQuery({
    queryKey: ['estate', estateId, 'community', 'guidelines'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/community/guidelines', { params: { path: { estateId } } }),
      ),
  });
}
