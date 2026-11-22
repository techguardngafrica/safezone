import { z } from 'zod';
import { koboSchema, positiveKoboSchema } from './billing';

/**
 * Payments (payments.md, Phase 2). Safezone never holds estate money: checkout settles straight to the
 * estate's provider subaccount. A payment is successful only after server-side verification.
 */
export const paymentProviderSchema = z.enum(['paystack', 'flutterwave', 'fake']);

export const payoutAccountSetupSchema = z.object({
  bankCode: z
    .string()
    .trim()
    .regex(/^\d{3,6}$/, 'Choose a bank'),
  /** NUBAN. Passed to the provider and never stored (only the last 4 digits are kept). */
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Enter the 10-digit account number'),
});

export const payoutAccountSchema = z.object({
  id: z.uuid(),
  provider: paymentProviderSchema,
  bankName: z.string(),
  accountName: z.string(),
  accountLast4: z.string().length(4),
  status: z.enum(['active', 'disabled']),
  verifiedAt: z.iso.datetime(),
});

export const bankSchema = z.object({ code: z.string(), name: z.string() });

export const paymentIntentStatusSchema = z.enum([
  'created',
  'pending',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
]);

export const createPaymentIntentSchema = z.object({
  /** Invoices to pay; when left out, every open invoice the caller pays. */
  invoiceIds: z.array(z.uuid()).min(1).max(50).optional(),
  /** Return URL after checkout; must be one of the estate's app links (checked server-side). */
  callbackUrl: z.url().optional(),
  /** Pay with one of my saved cards instead of checkout (ADR-0025). */
  paymentMethodId: z.uuid().optional(),
  /** Save the card used at checkout for next time (only reusable card authorizations are kept). */
  saveCard: z.boolean().optional(),
});

export const paymentIntentSchema = z.object({
  id: z.uuid(),
  purpose: z.literal('invoice'),
  invoiceIds: z.array(z.uuid()),
  amount: positiveKoboSchema,
  currency: z.literal('NGN'),
  provider: paymentProviderSchema,
  reference: z.string(),
  status: paymentIntentStatusSchema,
  /** Provider checkout page; present while the intent is open. */
  authorizationUrl: z.url().nullable(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  paidAt: z.iso.datetime().nullable(),
});

export const transactionSchema = z.object({
  id: z.uuid(),
  intentId: z.uuid().nullable(),
  provider: paymentProviderSchema,
  channel: z.string(),
  amount: koboSchema,
  fees: koboSchema,
  status: z.enum(['succeeded', 'refunded', 'partially_refunded']),
  payerUserId: z.uuid(),
  reference: z.string(),
  paidAt: z.iso.datetime(),
});

export const transactionListQuerySchema = z.object({
  payerUserId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});

export const virtualAccountSchema = z.object({
  id: z.uuid(),
  spaceId: z.uuid(),
  provider: paymentProviderSchema,
  accountNumber: z.string(),
  bankName: z.string(),
  accountName: z.string(),
  status: z.enum(['active', 'inactive']),
  createdAt: z.iso.datetime(),
});

export const createVirtualAccountSchema = z.object({ spaceId: z.uuid() });

export const manualPaymentMethodSchema = z.enum(['cash', 'cheque', 'bank_deposit', 'pos']);

export const createManualPaymentSchema = z.object({
  payerUserId: z.uuid(),
  spaceId: z.uuid().optional(),
  amount: positiveKoboSchema,
  method: manualPaymentMethodSchema,
  receivedOn: z.iso.date(),
  reference: z.string().trim().max(120).optional(),
  evidenceFileId: z.uuid().optional(),
  note: z.string().trim().max(500).optional(),
});

export const manualPaymentSchema = z.object({
  id: z.uuid(),
  payerUserId: z.uuid(),
  spaceId: z.uuid().nullable(),
  amount: koboSchema,
  method: manualPaymentMethodSchema,
  receivedOn: z.iso.date(),
  reference: z.string().nullable(),
  evidenceFileId: z.uuid().nullable(),
  note: z.string().nullable(),
  status: z.enum(['pending', 'approved', 'rejected']),
  recordedBy: z.uuid(),
  decidedBy: z.uuid().nullable(),
  decisionReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const manualPaymentListQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});

export const decisionReasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const optionalDecisionSchema = z.object({ reason: z.string().trim().max(500).optional() });

export const createRefundSchema = z.object({
  transactionId: z.uuid(),
  amount: positiveKoboSchema,
  reason: z.string().trim().min(3).max(500),
});

export const refundSchema = z.object({
  id: z.uuid(),
  transactionId: z.uuid(),
  amount: koboSchema,
  reason: z.string(),
  status: z.enum(['pending', 'approved', 'processing', 'completed', 'failed', 'rejected']),
  requestedBy: z.uuid(),
  decidedBy: z.uuid().nullable(),
  providerRef: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const refundListQuerySchema = z.object({
  status: z
    .enum(['pending', 'approved', 'processing', 'completed', 'failed', 'rejected'])
    .optional(),
});

export const providerParamSchema = z.object({ provider: z.enum(['paystack', 'fake']) });

// ---- Safezone Pay (ADR-0025): saved cards, payout accounts, transfers ----------------------------

export const paymentMethodSchema = z.object({
  id: z.uuid(),
  brand: z.string(),
  last4: z.string(),
  expMonth: z.string(),
  expYear: z.string(),
  bank: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});

export const userPayoutAccountSchema = z.object({
  bankName: z.string(),
  accountLast4: z.string(),
  acceptTransfers: z.boolean(),
  createdAt: z.iso.datetime(),
});
export const linkUserPayoutSchema = z.object({
  bankCode: z.string().trim().min(2).max(10),
  accountNumber: z.string().regex(/^\d{10}$/, 'Account numbers are 10 digits'),
});
export const updateUserPayoutSchema = z.object({ acceptTransfers: z.boolean() });

export const TRANSFER_MIN_KOBO = 10_000;
export const TRANSFER_MAX_KOBO = 50_000_000;
export const transferRecipientQuerySchema = z.object({ unit: z.string().trim().min(1).max(40) });
export const transferRecipientSchema = z.object({
  userId: z.uuid(),
  /** First name only (data minimisation). */
  firstName: z.string(),
});
export const createTransferSchema = z.object({
  recipientUserId: z.uuid(),
  amountKobo: z.number().int().min(TRANSFER_MIN_KOBO).max(TRANSFER_MAX_KOBO),
  note: z.string().trim().max(140).optional(),
  /** Paying a neighbour for a classified listing. */
  classifiedId: z.uuid().optional(),
  paymentMethodId: z.uuid().optional(),
  saveCard: z.boolean().optional(),
  callbackUrl: z.url().max(500).optional(),
});
export const transferSchema = z.object({
  id: z.uuid(),
  direction: z.enum(['sent', 'received']),
  counterpartyFirstName: z.string(),
  amountKobo: z.number().int(),
  note: z.string().nullable(),
  status: z.enum(['created', 'paid', 'failed']),
  authorizationUrl: z.string().nullable(),
  paidAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export const moneyTransferListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).optional(),
});
export const transfersStatusSchema = z.object({ enabled: z.boolean() });
