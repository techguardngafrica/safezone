import { z } from 'zod';
import { ledgerAccountTypeSchema } from './billing';
import { paginationQuerySchema } from './common';

const accountingDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const positiveKoboSchema = z.number().int().positive();
const nonNegativeKoboSchema = z.number().int().nonnegative();

export const coaAccountSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  type: ledgerAccountTypeSchema,
  parentCode: z.string().nullable(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type CoaAccount = z.infer<typeof coaAccountSchema>;

export const createCoaAccountSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(
      /^[a-z0-9:._-]+$/i,
      'Account code may use letters, numbers, colons, dots, dashes and underscores',
    ),
  name: z.string().trim().min(2).max(160),
  type: ledgerAccountTypeSchema,
  parentCode: z.string().trim().max(64).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
});

export const updateCoaAccountSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  parentCode: z.string().trim().max(64).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  archived: z.boolean().optional(),
});

export const manualJournalLineInputSchema = z
  .object({
    accountCode: z.string().trim().min(2).max(64),
    debit: nonNegativeKoboSchema.default(0),
    credit: nonNegativeKoboSchema.default(0),
  })
  .refine((l) => l.debit > 0 !== l.credit > 0, 'Each line must have either a debit or a credit');

export const createManualJournalSchema = z.object({
  description: z.string().trim().min(3).max(300),
  occurredOn: accountingDateSchema.optional(),
  reference: z.string().trim().max(120).optional(),
  lines: z.array(manualJournalLineInputSchema).min(2).max(100),
});

export const reverseJournalSchema = z.object({
  reason: z.string().trim().min(3).max(300),
  occurredOn: accountingDateSchema.optional(),
});

export const journalSummarySchema = z.object({
  id: z.uuid(),
  type: z.string(),
  description: z.string(),
  sourceType: z.string(),
  sourceId: z.string(),
  reference: z.string().nullable(),
  postedBy: z.uuid().nullable(),
  reversesJournalId: z.uuid().nullable(),
  postedAt: z.iso.datetime(),
  lines: z.array(
    z.object({
      accountCode: z.string(),
      accountName: z.string(),
      accountType: ledgerAccountTypeSchema,
      debit: nonNegativeKoboSchema,
      credit: nonNegativeKoboSchema,
    }),
  ),
});

// ---- Financial periods --------------------------------------------------------------------------

export const financialPeriodStatusSchema = z.enum(['open', 'closed']);

export const financialPeriodSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  startsOn: accountingDateSchema,
  endsOn: accountingDateSchema,
  status: financialPeriodStatusSchema,
  closedBy: z.uuid().nullable(),
  closedAt: z.iso.datetime().nullable(),
  closingJournalId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});

export const createFinancialPeriodSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    startsOn: accountingDateSchema,
    endsOn: accountingDateSchema,
  })
  .refine((v) => v.endsOn >= v.startsOn, 'Period end date must be on or after start date');

// ---- Budgets ------------------------------------------------------------------------------------

export const budgetStatusSchema = z.enum(['draft', 'approved', 'archived']);

export const budgetLineInputSchema = z.object({
  accountCode: z.string().trim().min(2).max(64),
  allocatedKobo: nonNegativeKoboSchema,
  notes: z.string().trim().max(300).optional(),
});

export const createBudgetSchema = z.object({
  name: z.string().trim().min(2).max(160),
  periodId: z.uuid(),
  lines: z.array(budgetLineInputSchema).min(1).max(200),
});

export const budgetLineViewSchema = z.object({
  id: z.uuid(),
  accountCode: z.string(),
  accountName: z.string(),
  accountType: ledgerAccountTypeSchema,
  allocatedKobo: nonNegativeKoboSchema,
  actualKobo: z.number().int(),
  varianceKobo: z.number().int(),
  notes: z.string().nullable(),
});

export const budgetSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  periodId: z.uuid(),
  periodName: z.string(),
  status: budgetStatusSchema,
  totalAllocatedKobo: nonNegativeKoboSchema,
  totalActualKobo: z.number().int(),
  createdBy: z.uuid(),
  approvedBy: z.uuid().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  lines: z.array(budgetLineViewSchema),
});

// ---- Expenses & Payables ------------------------------------------------------------------------

export const expenseStatusSchema = z.enum(['draft', 'submitted', 'approved', 'posted', 'rejected']);

export const createExpenseSchema = z.object({
  categoryAccountCode: z.string().trim().min(2).max(64),
  cashAccountCode: z.string().trim().min(2).max(64).default('cash:bank'),
  vendorName: z.string().trim().min(2).max(160),
  description: z.string().trim().min(3).max(500),
  amountKobo: positiveKoboSchema,
  incurredOn: accountingDateSchema,
  receiptFileId: z.uuid().optional(),
});

export const expenseSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  categoryAccountCode: z.string(),
  cashAccountCode: z.string(),
  vendorName: z.string(),
  description: z.string(),
  amountKobo: positiveKoboSchema,
  incurredOn: accountingDateSchema,
  receiptFileId: z.uuid().nullable(),
  status: expenseStatusSchema,
  requestedBy: z.uuid(),
  approvedBy: z.uuid().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  rejectionReason: z.string().nullable(),
  journalId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});

export const expenseListQuerySchema = paginationQuerySchema.extend({
  status: expenseStatusSchema.optional(),
});

export const payableStatusSchema = z.enum([
  'draft',
  'matched',
  'approved',
  'partially_paid',
  'paid',
  'void',
]);

export const createPayableSchema = z.object({
  supplierId: z.uuid().optional(),
  supplierName: z.string().trim().min(2).max(160),
  poId: z.uuid().optional(),
  grnId: z.uuid().optional(),
  invoiceRef: z.string().trim().min(1).max(120),
  expenseAccountCode: z.string().trim().min(2).max(64),
  amountKobo: positiveKoboSchema,
  dueOn: accountingDateSchema,
});

export const payPayableSchema = z.object({
  amountKobo: positiveKoboSchema,
  paidOn: accountingDateSchema,
  cashAccountCode: z.string().trim().min(2).max(64).default('cash:bank'),
  reference: z.string().trim().max(120).optional(),
});

export const payablePaymentSchema = z.object({
  id: z.uuid(),
  amountKobo: positiveKoboSchema,
  paidOn: accountingDateSchema,
  cashAccountCode: z.string(),
  reference: z.string().nullable(),
  recordedBy: z.uuid(),
  journalId: z.uuid(),
  createdAt: z.iso.datetime(),
});

export const payableSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  supplierId: z.uuid().nullable(),
  supplierName: z.string(),
  poId: z.uuid().nullable(),
  grnId: z.uuid().nullable(),
  invoiceRef: z.string(),
  expenseAccountCode: z.string(),
  amountKobo: positiveKoboSchema,
  amountPaidKobo: nonNegativeKoboSchema,
  balanceKobo: nonNegativeKoboSchema,
  dueOn: accountingDateSchema,
  status: payableStatusSchema,
  requestedBy: z.uuid().nullable(),
  approvedBy: z.uuid().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  journalId: z.uuid().nullable(),
  payments: z.array(payablePaymentSchema).optional(),
  createdAt: z.iso.datetime(),
});

export const payableListQuerySchema = paginationQuerySchema.extend({
  status: payableStatusSchema.optional(),
});

// ---- Bank Reconciliation ------------------------------------------------------------------------

export const bankLineDirectionSchema = z.enum(['credit', 'debit']);
export const bankLineStatusSchema = z.enum(['unmatched', 'matched', 'ignored']);

export const importBankStatementSchema = z.object({
  cashAccountCode: z.string().trim().min(2).max(64).default('cash:bank'),
  name: z.string().trim().min(2).max(160),
  statementFrom: accountingDateSchema,
  statementTo: accountingDateSchema,
  openingBalanceKobo: z.number().int(),
  closingBalanceKobo: z.number().int(),
  lines: z
    .array(
      z.object({
        txnDate: accountingDateSchema,
        description: z.string().trim().min(1).max(300),
        reference: z.string().trim().max(120).optional(),
        amountKobo: positiveKoboSchema,
        direction: bankLineDirectionSchema,
      }),
    )
    .min(1)
    .max(2000),
});

export const bankStatementLineSchema = z.object({
  id: z.uuid(),
  txnDate: accountingDateSchema,
  description: z.string(),
  reference: z.string().nullable(),
  amountKobo: positiveKoboSchema,
  direction: bankLineDirectionSchema,
  matchedJournalId: z.uuid().nullable(),
  status: bankLineStatusSchema,
});

export const bankStatementSchema = z.object({
  id: z.uuid(),
  cashAccountCode: z.string(),
  name: z.string(),
  statementFrom: accountingDateSchema,
  statementTo: accountingDateSchema,
  openingBalanceKobo: z.number().int(),
  closingBalanceKobo: z.number().int(),
  matchedCount: z.number().int(),
  unmatchedCount: z.number().int(),
  createdAt: z.iso.datetime(),
  lines: z.array(bankStatementLineSchema).optional(),
});

export const matchBankLineSchema = z.object({
  status: bankLineStatusSchema,
  journalId: z.uuid().nullable().optional(),
});

// ---- Financial Statements & Export --------------------------------------------------------------

export const accountingRangeQuerySchema = z.object({
  from: accountingDateSchema,
  to: accountingDateSchema,
});

export const accountingAsOfQuerySchema = z.object({
  asOf: accountingDateSchema,
});

export const statementAccountRowSchema = z.object({
  code: z.string(),
  name: z.string(),
  amountKobo: z.number().int(),
});

export const incomeStatementSchema = z.object({
  from: accountingDateSchema,
  to: accountingDateSchema,
  currency: z.literal('NGN'),
  income: z.array(statementAccountRowSchema),
  expenses: z.array(statementAccountRowSchema),
  totalIncomeKobo: z.number().int(),
  totalExpensesKobo: z.number().int(),
  netIncomeKobo: z.number().int(),
});

export const balanceSheetSchema = z.object({
  asOf: accountingDateSchema,
  currency: z.literal('NGN'),
  assets: z.array(statementAccountRowSchema),
  liabilities: z.array(statementAccountRowSchema),
  equity: z.array(statementAccountRowSchema),
  retainedEarningsKobo: z.number().int(),
  totalAssetsKobo: z.number().int(),
  totalLiabilitiesKobo: z.number().int(),
  totalEquityKobo: z.number().int(),
});

export const cashFlowStatementSchema = z.object({
  from: accountingDateSchema,
  to: accountingDateSchema,
  currency: z.literal('NGN'),
  openingCashKobo: z.number().int(),
  inflowsKobo: z.number().int(),
  outflowsKobo: z.number().int(),
  netCashChangeKobo: z.number().int(),
  closingCashKobo: z.number().int(),
  byAccount: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      inflowsKobo: z.number().int(),
      outflowsKobo: z.number().int(),
      netKobo: z.number().int(),
    }),
  ),
});

export const accountingExportQuerySchema = z.object({
  from: accountingDateSchema,
  to: accountingDateSchema,
  kind: z.enum(['journals', 'trial_balance']).default('journals'),
});

export const accountingExportResponseSchema = z.object({
  filename: z.string(),
  contentType: z.literal('text/csv'),
  csv: z.string(),
});

export const rejectReasonSchema = z.object({
  reason: z.string().trim().min(3).max(300),
});
