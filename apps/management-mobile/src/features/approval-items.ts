/**
 * The unified approvals inbox (management-mobile.md §6, tab 2): pending items from several modules,
 * normalised into one list, newest first. Pure, so it is unit-tested without React Native.
 */

export type ApprovalKind = 'join' | 'billing_run' | 'waiver' | 'booking';

export interface ApprovalItem {
  kind: ApprovalKind;
  id: string;
  /** Who or what is asking. */
  title: string;
  /** Short detail line (unit, amount, facility). */
  detail: string;
  /** Free text from the requester, if any. */
  note: string | null;
  createdAt: string;
  /** Waivers are approved through their invoice. */
  invoiceId?: string;
}

export interface JoinRequestLike {
  id: string;
  fullName: string | null;
  unit: { code: string; name: string };
  relationship: string;
  message: string | null;
  status: string;
  createdAt: string;
}

export interface BillingRunLike {
  id: string;
  label: string;
  status: string;
  totals: { invoices: number; amount: number } | null;
  createdAt: string;
}

export interface WaiverLike {
  id: string;
  invoiceId: string;
  amount: number;
  reason: string;
  status: string;
  createdAt: string;
}

export interface BookingLike {
  id: string;
  facilityName: string;
  startsAt: string;
  purpose: string | null;
  status: string;
  createdAt: string;
}

export interface ApprovalSources {
  joins?: JoinRequestLike[];
  runs?: BillingRunLike[];
  waivers?: WaiverLike[];
  bookings?: BookingLike[];
}

/** Formatting is injected so this file stays free of i18n and Intl. */
export interface ApprovalFormat {
  unknownName: string;
  relationship: (relationship: string) => string;
  money: (kobo: number) => string;
  dateTime: (iso: string) => string;
  runDetail: (invoices: number, amount: string) => string;
}

export function toApprovalItems(sources: ApprovalSources, format: ApprovalFormat): ApprovalItem[] {
  const items: ApprovalItem[] = [];
  for (const join of sources.joins ?? []) {
    if (join.status !== 'awaiting_manager') continue;
    items.push({
      kind: 'join',
      id: join.id,
      title: join.fullName ?? format.unknownName,
      detail: `${join.unit.code} · ${format.relationship(join.relationship)}`,
      note: join.message,
      createdAt: join.createdAt,
    });
  }
  for (const run of sources.runs ?? []) {
    if (run.status !== 'awaiting_approval') continue;
    items.push({
      kind: 'billing_run',
      id: run.id,
      title: run.label,
      detail: run.totals
        ? format.runDetail(run.totals.invoices, format.money(run.totals.amount))
        : '',
      note: null,
      createdAt: run.createdAt,
    });
  }
  for (const waiver of sources.waivers ?? []) {
    if (waiver.status !== 'pending') continue;
    items.push({
      kind: 'waiver',
      id: waiver.id,
      invoiceId: waiver.invoiceId,
      title: format.money(waiver.amount),
      detail: waiver.reason,
      note: null,
      createdAt: waiver.createdAt,
    });
  }
  for (const booking of sources.bookings ?? []) {
    if (booking.status !== 'pending_approval') continue;
    items.push({
      kind: 'booking',
      id: booking.id,
      title: booking.facilityName,
      detail: format.dateTime(booking.startsAt),
      note: booking.purpose,
      createdAt: booking.createdAt,
    });
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Rejecting always needs a reason (3+ characters, as the API requires); approving never does. */
export function reasonIsValid(action: 'approve' | 'reject', reason: string): boolean {
  const length = reason.trim().length;
  if (action === 'reject') return length >= 3;
  return length === 0 || length >= 3;
}

/** Badge text for the tab: exact up to 9, then "9+". */
export function badgeLabel(count: number): string {
  return count > 9 ? '9+' : String(count);
}
