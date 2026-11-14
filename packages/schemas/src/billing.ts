import { z } from 'zod';
import { unitTypeSchema } from './property';

/**
 * Billing: estates billing residents (billing.md, Phase 2). All money is integer kobo with currency NGN.
 * Issued invoices are immutable; corrections are credit notes, waivers or new invoices.
 */

/** ₦1,000,000,000 in kobo: far above any estate charge, well inside Number.MAX_SAFE_INTEGER. */
export const MAX_KOBO = 100_000_000_000;
export const koboSchema = z.number().int().nonnegative().max(MAX_KOBO);
export const positiveKoboSchema = z.number().int().positive().max(MAX_KOBO);
const dateOnlySchema = z.iso.date();

export const chargeTypeSchema = z.enum([
  'estate_dues',
  'service_charge',
  'maintenance_charge',
  'security_levy',
  'development_levy',
  'utility_charge',
  'special_assessment',
  'custom',
]);
export const chargeFrequencySchema = z.enum(['one_off', 'monthly', 'quarterly', 'annual']);
/** Occupant: the household head. Owner: the unit's primary owner (largest share). */
export const chargePayerSchema = z.enum(['occupant', 'owner']);

export const amountRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed'), amount: positiveKoboSchema }),
  z.object({
    kind: z.literal('per_unit_type'),
    /** Amount per unit type; unit types left out are not billed unless `otherwise` is set. */
    amounts: z.partialRecord(unitTypeSchema, positiveKoboSchema),
    otherwise: positiveKoboSchema.optional(),
  }),
  z.object({
    kind: z.literal('per_bedroom'),
    amount: positiveKoboSchema,
    /** Units with no bedroom count, or fewer, pay this many bedrooms. */
    minimumBedrooms: z.number().int().min(0).max(20).default(1),
  }),
  z.object({
    kind: z.literal('per_sqm'),
    /** Kobo per square metre; units without a size are skipped. */
    amount: positiveKoboSchema,
  }),
  z.object({
    /** Estate-run supply: consumption in the period × rate, plus an optional fixed charge (utilities.md §4.2). */
    kind: z.literal('metered'),
    utility: z.enum(['electricity', 'water', 'gas']),
    /** Kobo per kWh or m³. */
    ratePerUnit: positiveKoboSchema,
    fixedAmount: positiveKoboSchema.optional(),
  }),
]);
export type AmountRule = z.infer<typeof amountRuleSchema>;

export const chargeAppliesToSchema = z.object({
  /** Units at or below these spaces. Empty means every unit. */
  spaceIds: z.array(z.uuid()).max(200).default([]),
  /** Only these unit types. Empty means every type. */
  unitTypes: z.array(unitTypeSchema).max(5).default([]),
});

/** Late payment penalty on a charge's unpaid principal, applied once per invoice after the grace period. */
export const penaltyRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed'), amount: positiveKoboSchema }),
  z.object({
    kind: z.literal('percent'),
    /** 500 = 5%. */
    basisPoints: z.number().int().min(1).max(5000),
    cap: positiveKoboSchema.optional(),
  }),
]);
export type PenaltyRule = z.infer<typeof penaltyRuleSchema>;

const chargeFields = {
  type: chargeTypeSchema,
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  amountRule: amountRuleSchema,
  frequency: chargeFrequencySchema,
  payer: chargePayerSchema.default('occupant'),
  appliesTo: chargeAppliesToSchema.default({ spaceIds: [], unitTypes: [] }),
  startsOn: dateOnlySchema,
  endsOn: dateOnlySchema.optional(),
  penaltyRule: penaltyRuleSchema.optional(),
};

export const createChargeSchema = z
  .object(chargeFields)
  .refine((value) => !value.endsOn || value.endsOn >= value.startsOn, {
    message: 'The end date must be on or after the start date',
    path: ['endsOn'],
  });

export const updateChargeSchema = z
  .object({
    name: chargeFields.name.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    amountRule: amountRuleSchema.optional(),
    appliesTo: chargeAppliesToSchema.optional(),
    endsOn: dateOnlySchema.nullable().optional(),
    penaltyRule: penaltyRuleSchema.nullable().optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

export const chargeSchema = z.object({
  id: z.uuid(),
  type: chargeTypeSchema,
  name: z.string(),
  description: z.string().nullable(),
  amountRule: amountRuleSchema,
  frequency: chargeFrequencySchema,
  payer: chargePayerSchema,
  appliesTo: chargeAppliesToSchema,
  startsOn: dateOnlySchema,
  endsOn: dateOnlySchema.nullable(),
  penaltyRule: penaltyRuleSchema.nullable(),
  status: z.enum(['active', 'archived']),
  currency: z.literal('NGN'),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
});

export const chargeListQuerySchema = z.object({
  status: z.enum(['active', 'archived']).optional(),
});

// ---- Billing runs ------------------------------------------------------------------------------

export const billingRunStatusSchema = z.enum([
  'draft',
  'previewed',
  'awaiting_approval',
  'approved',
  'issued',
  'cancelled',
]);

export const createBillingRunSchema = z
  .object({
    /** Shown on invoices, e.g. "January 2027 dues". */
    label: z.string().trim().min(2).max(120),
    periodStart: dateOnlySchema,
    periodEnd: dateOnlySchema,
    dueDate: dateOnlySchema,
    chargeIds: z.array(z.uuid()).min(1).max(20),
  })
  .refine((value) => value.periodEnd >= value.periodStart, {
    message: 'The period must end on or after it starts',
    path: ['periodEnd'],
  })
  .refine((value) => value.dueDate >= value.periodStart, {
    message: 'The due date must be on or after the start of the period',
    path: ['dueDate'],
  });

export const billingRunTotalsSchema = z.object({
  invoices: z.number().int(),
  amount: koboSchema,
  skippedUnits: z.number().int(),
});

export const billingRunSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  periodStart: dateOnlySchema,
  periodEnd: dateOnlySchema,
  dueDate: dateOnlySchema,
  chargeIds: z.array(z.uuid()),
  status: billingRunStatusSchema,
  totals: billingRunTotalsSchema.nullable(),
  currency: z.literal('NGN'),
  createdBy: z.uuid(),
  approvedBy: z.uuid().nullable(),
  approvalRequired: z.boolean().nullable(),
  cancelReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  issuedAt: z.iso.datetime().nullable(),
});

export const billingRunItemSchema = z.object({
  spaceId: z.uuid(),
  unitCode: z.string(),
  payerName: z.string().nullable(),
  amount: koboSchema,
  lines: z.array(
    z.object({
      chargeId: z.uuid(),
      description: z.string(),
      quantity: z.number(),
      unitAmount: koboSchema,
      amount: koboSchema,
    }),
  ),
  /** Why the unit gets no invoice (vacant, rule did not apply, payer changed before issue). */
  payerType: chargePayerSchema,
  skipReason: z.enum(['vacant', 'no_owner', 'not_applicable', 'payer_changed']).nullable(),
  invoiceId: z.uuid().nullable(),
});

export const billingRunItemsQuerySchema = z.object({
  skipped: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});

export const cancelBillingRunSchema = z.object({ reason: z.string().trim().min(3).max(500) });

// ---- Invoices ----------------------------------------------------------------------------------

export const invoiceStatusSchema = z.enum([
  'issued',
  'partially_paid',
  'paid',
  'overdue',
  'waived',
  'cancelled',
]);

export const invoiceLineSchema = z.object({
  id: z.uuid(),
  chargeId: z.uuid().nullable(),
  description: z.string(),
  quantity: z.number(),
  unitAmount: koboSchema,
  amount: koboSchema,
});

export const invoiceSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  spaceId: z.uuid(),
  unitCode: z.string().nullable(),
  payerUserId: z.uuid(),
  payerType: chargePayerSchema,
  billingRunId: z.uuid().nullable(),
  /** Set on late-payment penalty invoices: the invoice that was paid late. */
  penaltyForInvoiceId: z.uuid().nullable(),
  description: z.string(),
  issueDate: dateOnlySchema,
  dueDate: dateOnlySchema,
  currency: z.literal('NGN'),
  subtotal: koboSchema,
  total: koboSchema,
  amountPaid: koboSchema,
  amountCredited: koboSchema,
  amountWaived: koboSchema,
  balance: koboSchema,
  status: invoiceStatusSchema,
  createdAt: z.iso.datetime(),
});

export const invoiceDetailSchema = invoiceSchema.extend({
  lines: z.array(invoiceLineSchema),
  creditNotes: z.array(
    z.object({
      id: z.uuid(),
      amount: koboSchema,
      reason: z.string(),
      createdAt: z.iso.datetime(),
    }),
  ),
  waivers: z.array(
    z.object({
      id: z.uuid(),
      amount: koboSchema,
      reason: z.string(),
      status: z.enum(['pending', 'approved', 'rejected']),
      createdAt: z.iso.datetime(),
    }),
  ),
  allocations: z.array(
    z.object({
      id: z.uuid(),
      amount: koboSchema,
      sourceType: z.string(),
      createdAt: z.iso.datetime(),
    }),
  ),
});

export const invoiceListQuerySchema = z.object({
  status: invoiceStatusSchema.optional(),
  spaceId: z.uuid().optional(),
  payerUserId: z.uuid().optional(),
  billingRunId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});

export const createInvoiceSchema = z.object({
  spaceId: z.uuid(),
  description: z.string().trim().min(2).max(120),
  dueDate: dateOnlySchema,
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(2).max(200),
        quantity: z.number().int().min(1).max(10_000).default(1),
        unitAmount: positiveKoboSchema,
        /** Optional link to a charge, for income reporting by charge type. */
        chargeId: z.uuid().optional(),
      }),
    )
    .min(1)
    .max(50),
});

export const createCreditNoteSchema = z.object({
  amount: positiveKoboSchema,
  reason: z.string().trim().min(3).max(500),
});

export const creditNoteSchema = z.object({
  id: z.uuid(),
  invoiceId: z.uuid(),
  amount: koboSchema,
  reason: z.string(),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
});

export const createWaiverSchema = createCreditNoteSchema;
export const waiverDecisionSchema = z.object({ reason: z.string().trim().max(500).optional() });
export const waiverRejectionSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const waiverSchema = z.object({
  id: z.uuid(),
  invoiceId: z.uuid(),
  amount: koboSchema,
  reason: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  requestedBy: z.uuid(),
  decidedBy: z.uuid().nullable(),
  decisionReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
});

export const waiverListQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});

export const invoiceWaiverParamsSchema = z.object({
  estateId: z.uuid(),
  id: z.uuid(),
  waiverId: z.uuid(),
});

// ---- Statements and ledger ---------------------------------------------------------------------

export const statementQuerySchema = z
  .object({
    spaceId: z.uuid().optional(),
    payerUserId: z.uuid().optional(),
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: '`from` must be on or before `to`',
    path: ['from'],
  });

export const statementSchema = z.object({
  spaceId: z.uuid().nullable(),
  payerUserId: z.uuid().nullable(),
  from: dateOnlySchema.nullable(),
  to: dateOnlySchema.nullable(),
  currency: z.literal('NGN'),
  /** Positive: owed to the estate. */
  openingBalance: z.number().int(),
  closingBalance: z.number().int(),
  /** Payments received but not yet allocated to an invoice. */
  unallocatedCredit: koboSchema,
  lines: z.array(
    z.object({
      date: z.iso.datetime(),
      type: z.enum(['invoice', 'payment', 'credit_note', 'waiver', 'adjustment']),
      description: z.string(),
      reference: z.string().nullable(),
      debit: koboSchema,
      credit: koboSchema,
      balance: z.number().int(),
    }),
  ),
});

export const ledgerAccountTypeSchema = z.enum([
  'asset',
  'liability',
  'income',
  'expense',
  'equity',
]);

export const ledgerQuerySchema = z.object({
  /** Account code prefix, e.g. `receivable:` or `income:estate_dues`. */
  account: z.string().trim().min(1).max(200).optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().min(1).optional(),
});

export const ledgerEntrySchema = z.object({
  id: z.uuid(),
  journalId: z.uuid(),
  journalType: z.string(),
  description: z.string(),
  accountCode: z.string(),
  accountName: z.string(),
  accountType: ledgerAccountTypeSchema,
  debit: koboSchema,
  credit: koboSchema,
  occurredAt: z.iso.datetime(),
});

export const ledgerBalanceSchema = z.object({
  code: z.string(),
  name: z.string(),
  type: ledgerAccountTypeSchema,
  debit: z.number().int(),
  credit: z.number().int(),
  /** Debit minus credit. */
  balance: z.number().int(),
});
