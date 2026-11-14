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
