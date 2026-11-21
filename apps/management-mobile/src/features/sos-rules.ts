import type { Tone } from '@safezone/mobile-ui';

/** SOS statuses from the API (emergency module state machine). */
export type SosStatus =
  'triggered' | 'acknowledged' | 'assigned' | 'responding' | 'resolved' | 'closed' | 'cancelled';

/** Statuses where responders still have work to do. */
export const ACTIVE_SOS: ReadonlySet<SosStatus> = new Set([
  'triggered',
  'acknowledged',
  'assigned',
  'responding',
]);

/** UI_GUIDELINES §6.8 SOS tones, as on management-web. */
export const SOS_TONE: Record<SosStatus, Tone> = {
  triggered: 'danger',
  acknowledged: 'warning',
  assigned: 'info',
  responding: 'info',
  resolved: 'success',
  closed: 'neutral',
  cancelled: 'neutral',
};

/** Which response actions an alert in this status offers (mirrors the API state machine). */
export function sosActions(status: SosStatus): {
  acknowledge: boolean;
  responding: boolean;
  resolve: boolean;
  close: boolean;
  note: boolean;
} {
  const active = ACTIVE_SOS.has(status);
  return {
    acknowledge: status === 'triggered',
    responding: status === 'acknowledged' || status === 'assigned',
    resolve: active && status !== 'triggered',
    close: status === 'resolved',
    note: status !== 'closed' && status !== 'cancelled',
  };
}
