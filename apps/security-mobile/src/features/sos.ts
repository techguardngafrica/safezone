import { type ApiData, unwrap } from '@safezone/api-client';
import { type MessageKey, t } from '@safezone/i18n';
import { useQuery } from '@tanstack/react-query';
import { useGate } from '../lib/gate';
import { api } from '../lib/session';

export type SosAlert = ApiData<'/v1/estates/{estateId}/sos', 'get'>[number];
export type SosDetail = ApiData<'/v1/estates/{estateId}/sos/{id}', 'get'>;

/** Poll interval while the app is open. Push (Expo) covers the app in the background. */
export const SOS_POLL_MS = 4_000;

/** Statuses where responders still have work to do. */
export const ACTIVE_SOS = new Set(['triggered', 'acknowledged', 'assigned', 'responding']);

export function useActiveSos() {
  const { estateId, hasFeature, can } = useGate();
  return useQuery({
    queryKey: ['estate', estateId, 'sos', 'active'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/sos', {
          params: { path: { estateId }, query: { status: 'active' } },
        }),
      ),
    enabled: Boolean(estateId) && hasFeature('emergency') && can('sos.respond'),
    refetchInterval: SOS_POLL_MS,
    refetchIntervalInBackground: true,
  });
}

export function categoryText(category: string): string {
  const key = `sos.category.${category}` as MessageKey;
  const text = t(key);
  return text === key ? t('sos.category.general') : text;
}

export function eventText(type: string): string {
  const key = `sec.sos.event.${type}` as MessageKey;
  const text = t(key);
  return text === key ? t('sec.sos.event.other') : text;
}
