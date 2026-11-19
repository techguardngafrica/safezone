import type { ApiRow } from '@safezone/api-client';
import type { Tone } from '@safezone/mobile-ui';

export type OwnedUnit = ApiRow<'/v1/estates/{estateId}/owned-units', 'get'>;
export type OwnerJoinRequest = ApiRow<'/v1/estates/{estateId}/join-requests', 'get'>;
export type OwnershipTransfer = ApiRow<'/v1/estates/{estateId}/ownership-transfers', 'get'>;

/** Converts ownership basis points (10,000 = 100%) to a clean display percentage. */
export function formatShare(basisPoints: number): string {
  const percent = basisPoints / 100;
  return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(2).replace(/\.?0+$/, '')}%`;
}

export const TRANSFER_TONE: Record<OwnershipTransfer['status'], Tone> = {
  requested: 'warning',
  seller_confirmed: 'info',
  completed: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

export function awaitingOwnerRequests(requests: readonly OwnerJoinRequest[]): OwnerJoinRequest[] {
  return requests.filter((request) => request.status === 'awaiting_owner');
}

/** The signed-in user holds one of the ownerships being transferred (they are the seller). */
export function isSeller(
  transfer: OwnershipTransfer,
  myOwnershipIds: ReadonlySet<string>,
): boolean {
  return transfer.fromOwnershipIds.some((id) => myOwnershipIds.has(id));
}

/** Only a current owner of the unit may confirm (the API refuses everyone else). */
export function canSellerConfirm(
  transfer: OwnershipTransfer,
  myOwnershipIds: ReadonlySet<string>,
): boolean {
  return transfer.status === 'requested' && isSeller(transfer, myOwnershipIds);
}

/** The seller may refuse a transfer someone else opened; the person who opened it cancels instead. */
export function canSellerReject(
  transfer: OwnershipTransfer,
  myOwnershipIds: ReadonlySet<string>,
  userId: string | undefined,
): boolean {
  return canSellerConfirm(transfer, myOwnershipIds) && transfer.requestedBy !== userId;
}

export function canCancelTransfer(
  transfer: OwnershipTransfer,
  userId: string | undefined,
): boolean {
  return (
    Boolean(userId) &&
    transfer.requestedBy === userId &&
    (transfer.status === 'requested' || transfer.status === 'seller_confirmed')
  );
}
