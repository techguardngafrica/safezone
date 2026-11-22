import type { Tone } from '@safezone/web-ui';

const nairaFormat = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 2,
});

/** Formats an ISO timestamp in WAT (Africa/Lagos) per AGENTS.md §5.4. */
export function formatWat(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return new Intl.DateTimeFormat('en-NG', {
      timeZone: 'Africa/Lagos',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatMoney(kobo: number): string {
  return nairaFormat.format(kobo / 100);
}

export function statusTone(status: string): Tone {
  switch (status) {
    case 'active':
    case 'approved':
    case 'succeeded':
    case 'completed':
    case 'resolved':
    case 'closed':
    case 'converted':
    case 'accepted':
    case 'ok':
    case 'live':
      return 'success';
    case 'submitted':
    case 'pending':
    case 'new':
    case 'received':
    case 'under_review':
    case 'in_progress':
    case 'open':
    case 'contacted':
    case 'identity_verified':
    case 'contained':
    case 'notified':
    case 'sandbox':
      return 'info';
    case 'info_requested':
    case 'pending_customer':
    case 'partially_refunded':
    case 'degraded':
    case 'high':
    case 'medium':
      return 'warning';
    case 'rejected':
    case 'suspended':
    case 'deactivated':
    case 'locked':
    case 'denied':
    case 'revoked':
    case 'expired':
    case 'refunded':
    case 'fail':
    case 'critical':
    case 'investigating':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function humanizeStatus(status: string): string {
  return status.replace(/_/g, ' ');
}
