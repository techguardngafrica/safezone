import { type ApiData, unwrap } from '@safezone/api-client';
import { type MessageKey, t } from '@safezone/i18n';
import { useQuery } from '@tanstack/react-query';
import { useManager } from '../lib/manager';
import { api } from '../lib/session';
import type { SosStatus } from './sos-rules';

export type SosAlert = ApiData<'/v1/estates/{estateId}/sos', 'get'>[number];
export type SosDetail = ApiData<'/v1/estates/{estateId}/sos/{id}', 'get'>;
export type { SosStatus } from './sos-rules';
export { ACTIVE_SOS, SOS_TONE, sosActions } from './sos-rules';

/** Fails to compile if the API adds an SOS status that sos-rules.ts does not know. */
export const SOS_STATUS_MATCHES_API: [SosAlert['status']] extends [SosStatus]
  ? [SosStatus] extends [SosAlert['status']]
    ? true
    : never
  : never = true;

/** Poll interval while the app is open. Expo push covers the app in the background. */
export const SOS_POLL_MS = 4_000;

export function useCanRespondToSos(): boolean {
  const { can, hasFeature } = useManager();
  return hasFeature('emergency') && can('sos.respond');
}

export function useActiveSos() {
  const { estateId } = useManager();
  const enabled = useCanRespondToSos();
  return useQuery({
    queryKey: ['estate', estateId, 'sos', 'active'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/sos', {
          params: { path: { estateId }, query: { status: 'active' } },
        }),
      ),
    enabled: Boolean(estateId) && enabled,
    refetchInterval: SOS_POLL_MS,
    refetchIntervalInBackground: true,
  });
}

export function sosStatusText(status: SosStatus): string {
  return t(`sos.status.${status}` as MessageKey);
}

export function categoryText(category: string): string {
  const key = `sos.category.${category}` as MessageKey;
  const text = t(key);
  return text === key ? t('sos.category.general') : text;
}

export function eventText(type: string): string {
  const key = `sos.event.${type}` as MessageKey;
  const text = t(key);
  return text === key ? type.replace(/[._]/g, ' ') : text;
}
