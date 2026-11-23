/**
 * The unified approvals inbox (management-mobile.md §6, tab 2): pending items from several modules,
 * normalised into one list, newest first. Pure, so it is unit-tested without React Native.
 */

export type ApprovalKind =
  | 'join'
  | 'billing_run'
  | 'waiver'
  | 'manual_payment'
  | 'refund'
  | 'booking'
  | 'staff_pass'
  | 'move'
  | 'channel'
  | 'ownership_transfer';

export type ApprovalCategory = 'all' | 'people' | 'finance' | 'facilities' | 'community';

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

export interface ManualPaymentLike {
  id: string;
  amount: number;
  method: string;
  reference: string | null;
  note: string | null;
  status: string;
  createdAt: string;
}

export interface RefundLike {
  id: string;
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

export interface DomesticStaffLike {
  id: string;
  name: string;
  role: string;
  status: string;
  createdAt?: string;
}

export interface MoveLike {
  id: string;
  type: string;
  unitCode: string | null;
  scheduledOn: string;
  gateNotice: { items?: string; vehicles?: string[]; notes?: string } | string | null;
  status: string;
  createdAt: string;
}

export interface ChannelLike {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  status: string;
  createdAt: string;
}

export interface OwnershipTransferLike {
  id: string;
  unitCode: string | null;
  type: string;
  reason: string | null;
  status: string;
  createdAt: string;
}

export interface ApprovalSources {
  joins?: JoinRequestLike[];
  runs?: BillingRunLike[];
  waivers?: WaiverLike[];
  manualPayments?: ManualPaymentLike[];
  refunds?: RefundLike[];
  bookings?: BookingLike[];
  domesticStaff?: DomesticStaffLike[];
  moves?: MoveLike[];
  channels?: ChannelLike[];
  ownershipTransfers?: OwnershipTransferLike[];
}

/** Formatting is injected so this file stays free of i18n and Intl. */
export interface ApprovalFormat {
  unknownName: string;
  relationship: (relationship: string) => string;
  money: (kobo: number) => string;
  dateTime: (iso: string) => string;
  runDetail: (invoices: number, amount: string) => string;
  moveType: (type: string) => string;
  moveDetail: (type: string, unit: string, date: string) => string;
  transferDetail: (unit: string, type: string) => string;
  paymentDetail: (method: string, ref: string) => string;
}

const KIND_CATEGORY: Record<ApprovalKind, Exclude<ApprovalCategory, 'all'>> = {
  join: 'people',
  staff_pass: 'people',
  move: 'people',
  ownership_transfer: 'people',
  billing_run: 'finance',
  waiver: 'finance',
  manual_payment: 'finance',
  refund: 'finance',
  booking: 'facilities',
  channel: 'community',
};

export function categoryOfKind(kind: ApprovalKind): Exclude<ApprovalCategory, 'all'> {
  return KIND_CATEGORY[kind];
}

export function filterApprovals(
  items: readonly ApprovalItem[],
  category: ApprovalCategory,
): ApprovalItem[] {
  if (category === 'all') return [...items];
  return items.filter((item) => KIND_CATEGORY[item.kind] === category);
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
  for (const payment of sources.manualPayments ?? []) {
    if (payment.status !== 'pending') continue;
    items.push({
      kind: 'manual_payment',
      id: payment.id,
      title: format.money(payment.amount),
      detail: format.paymentDetail(payment.method, payment.reference ?? '-'),
      note: payment.note,
      createdAt: payment.createdAt,
    });
  }
  for (const refund of sources.refunds ?? []) {
    if (refund.status !== 'pending') continue;
    items.push({
      kind: 'refund',
      id: refund.id,
      title: format.money(refund.amount),
      detail: refund.reason,
      note: null,
      createdAt: refund.createdAt,
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
  for (const staff of sources.domesticStaff ?? []) {
    if (staff.status !== 'pending') continue;
    items.push({
      kind: 'staff_pass',
      id: staff.id,
      title: staff.name,
      detail: staff.role,
      note: null,
      createdAt: staff.createdAt ?? '',
    });
  }
  for (const move of sources.moves ?? []) {
    if (move.status !== 'scheduled') continue;
    const notice =
      typeof move.gateNotice === 'string'
        ? move.gateNotice
        : (move.gateNotice?.notes ?? move.gateNotice?.items ?? null);
    items.push({
      kind: 'move',
      id: move.id,
      title: format.moveType(move.type),
      detail: format.moveDetail(format.moveType(move.type), move.unitCode ?? '-', move.scheduledOn),
      note: notice,
      createdAt: move.createdAt,
    });
  }
  for (const channel of sources.channels ?? []) {
    if (channel.status !== 'pending_approval') continue;
    items.push({
      kind: 'channel',
      id: channel.id,
      title: channel.name,
      detail: channel.category ?? '',
      note: channel.description,
      createdAt: channel.createdAt,
    });
  }
  for (const transfer of sources.ownershipTransfers ?? []) {
    if (transfer.status !== 'pending_approval' && transfer.status !== 'confirmed') continue;
    items.push({
      kind: 'ownership_transfer',
      id: transfer.id,
      title: transfer.unitCode ?? format.unknownName,
      detail: format.transferDetail(transfer.unitCode ?? '-', transfer.type),
      note: transfer.reason,
      createdAt: transfer.createdAt,
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
