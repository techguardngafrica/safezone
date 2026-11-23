/**
 * Procurement & Inventory domain rules (procurement.md §2, §3, §5).
 * Pure functions only: approval bands, 3-way match tolerance, weighted average cost.
 */

/** Approval bands in integer kobo (procurement.md §2.3): < ₦100k, < ₦1m, ≥ ₦1m. */
export const BAND_FACILITY_MAX_KOBO = 10_000_000; // ₦100,000
export const BAND_MANAGER_MAX_KOBO = 100_000_000; // ₦1,000,000
export const QUOTE_THRESHOLD_KOBO = 10_000_000; // ₦100,000 -> requires >= 3 quotes or justification

/** Ordered approver roles required for a PR of a given estimated total. */
export function requiredApprovalRoles(estimatedTotalKobo: number): readonly string[] {
  if (estimatedTotalKobo < BAND_FACILITY_MAX_KOBO) {
    return ['facility_manager'];
  }
  if (estimatedTotalKobo < BAND_MANAGER_MAX_KOBO) {
    return ['facility_manager', 'estate_manager'];
  }
  return ['facility_manager', 'estate_manager', 'estate_owner'];
}

/** Three-way match check (procurement.md rule 6): invoice within ±tolerancePercent of PO/GRN value. */
export function isWithinThreeWayTolerance(
  expectedKobo: number,
  invoiceKobo: number,
  tolerancePercent = 2,
): { ok: boolean; diffPercent: number } {
  if (expectedKobo <= 0) return { ok: false, diffPercent: 100 };
  const diff = Math.abs(invoiceKobo - expectedKobo);
  const diffPercent = (diff / expectedKobo) * 100;
  return { ok: diffPercent <= tolerancePercent, diffPercent: Math.round(diffPercent * 100) / 100 };
}

/** Moving weighted average cost in integer kobo after receiving `incomingQty` at `incomingUnitCostKobo`. */
export function computeWeightedAverageCost(
  currentOnHand: number,
  currentAvgCostKobo: number,
  incomingQty: number,
  incomingUnitCostKobo: number,
): number {
  const safeCurrent = Math.max(0, currentOnHand);
  const totalQty = safeCurrent + incomingQty;
  if (totalQty <= 0) return incomingUnitCostKobo;
  return Math.round(
    (safeCurrent * currentAvgCostKobo + incomingQty * incomingUnitCostKobo) / totalQty,
  );
}

/** Signed quantity delta for a stock movement. */
export function signedQtyDelta(
  type: 'receipt' | 'issue' | 'transfer' | 'return' | 'adjustment',
  qty: number,
  direction?: 'in' | 'out',
): number {
  if (type === 'receipt' || type === 'return') return Math.abs(qty);
  if (type === 'issue') return -Math.abs(qty);
  return direction === 'out' ? -Math.abs(qty) : Math.abs(qty);
}
