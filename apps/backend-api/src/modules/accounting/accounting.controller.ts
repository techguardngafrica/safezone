import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  accountingAsOfQuerySchema,
  accountingExportQuerySchema,
  accountingExportResponseSchema,
  accountingRangeQuerySchema,
  balanceSheetSchema,
  bankStatementLineSchema,
  bankStatementSchema,
  budgetSchema,
  cashFlowStatementSchema,
  coaAccountSchema,
  createBudgetSchema,
  createCoaAccountSchema,
  createExpenseSchema,
  createFinancialPeriodSchema,
  createManualJournalSchema,
  createPayableSchema,
  estateParamSchema,
  expenseListQuerySchema,
  expenseSchema,
  financialPeriodSchema,
  importBankStatementSchema,
  incomeStatementSchema,
  journalSummarySchema,
  matchBankLineSchema,
  payableListQuerySchema,
  payableSchema,
  payPayableSchema,
  rejectReasonSchema,
  reverseJournalSchema,
  updateCoaAccountSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import { Can, CurrentEstate, type EstateAccess } from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { AccountingService } from './accounting.service';

const estateResourceParamSchema = estateParamSchema.extend({ id: z.uuid() });
const dateOnlyParamSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalRangeQuerySchema = z.object({
  from: dateOnlyParamSchema.optional(),
  to: dateOnlyParamSchema.optional(),
});

@Controller('v1/estates/:estateId/accounting')
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  // ---- Chart of Accounts ------------------------------------------------------------------------

  @Get('accounts')
  @Can('accounting.read')
  @Contract({
    summary: 'List estate chart of accounts',
    tags: ['accounting'],
    params: estateParamSchema,
    response: z.array(coaAccountSchema),
  })
  listAccounts(@CurrentEstate() estate: EstateAccess) {
    return this.accounting.listAccounts(estate);
  }

  @Post('accounts')
  @Can('accounting.manage')
  @Contract({
    summary: 'Create a chart of accounts entry',
    tags: ['accounting'],
    params: estateParamSchema,
    body: createCoaAccountSchema,
    response: coaAccountSchema,
    status: 201,
    errors: [409],
  })
  createAccount(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createCoaAccountSchema>,
  ) {
    return this.accounting.createAccount(estate, body);
  }

  @Patch('accounts/:id')
  @Can('accounting.manage')
  @Contract({
    summary: 'Update or archive a chart of accounts entry',
    tags: ['accounting'],
    params: estateResourceParamSchema,
    body: updateCoaAccountSchema,
    response: coaAccountSchema,
    errors: [404, 422],
  })
  updateAccount(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateResourceParamSchema>,
    @ValidBody() body: z.infer<typeof updateCoaAccountSchema>,
  ) {
    return this.accounting.updateAccount(estate, params.id, body);
  }

  // ---- Journals ---------------------------------------------------------------------------------

  @Get('journals')
  @Can('accounting.read')
  @Contract({
    summary: 'List general ledger journals with balanced lines',
    tags: ['accounting'],
    params: estateParamSchema,
    query: optionalRangeQuerySchema,
    response: z.array(journalSummarySchema),
  })
  listJournals(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof optionalRangeQuerySchema>,
  ) {
    return this.accounting.listJournals(estate, query);
  }

  @Post('journals')
  @Can('accounting.manage')
  @Contract({
    summary: 'Post a balanced manual journal entry',
    tags: ['accounting'],
    params: estateParamSchema,
    body: createManualJournalSchema,
    response: journalSummarySchema,
    status: 201,
    errors: [409, 422],
  })
  createManualJournal(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createManualJournalSchema>,
  ) {
    return this.accounting.createManualJournal(estate, body);
  }

  @Post('journals/:id/reverse')
  @Can('accounting.manage')
  @HttpCode(201)
  @Contract({
    summary: 'Post a reversing journal for an existing journal',
    tags: ['accounting'],
    params: estateResourceParamSchema,
    body: reverseJournalSchema,
    response: journalSummarySchema,
    status: 201,
    errors: [404, 409],
  })
  reverseJournal(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateResourceParamSchema>,
    @ValidBody() body: z.infer<typeof reverseJournalSchema>,
  ) {
    return this.accounting.reverseJournal(estate, params.id, body);
  }

  // ---- Financial Periods ------------------------------------------------------------------------

  @Get('periods')
  @Can('accounting.read')
  @Contract({
    summary: 'List financial periods',
    tags: ['accounting'],
    params: estateParamSchema,
    response: z.array(financialPeriodSchema),
  })
  listPeriods(@CurrentEstate() estate: EstateAccess) {
    return this.accounting.listPeriods(estate);
  }

  @Post('periods')
  @Can('accounting.manage')
  @Contract({
    summary: 'Create a financial period',
    tags: ['accounting'],
    params: estateParamSchema,
    body: createFinancialPeriodSchema,
    response: financialPeriodSchema,
    status: 201,
    errors: [409],
  })
  createPeriod(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createFinancialPeriodSchema>,
  ) {
    return this.accounting.createPeriod(estate, body);
  }

  @Post('periods/:id/close')
  @Can('accounting.manage')
  @HttpCode(200)
  @Contract({
    summary: 'Close a financial period and post net income to retained earnings',
    tags: ['accounting'],
    params: estateResourceParamSchema,
    response: financialPeriodSchema,
    errors: [404, 409],
  })
  closePeriod(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateResourceParamSchema>,
  ) {
    return this.accounting.closePeriod(estate, params.id);
  }

  // ---- Budgets ----------------------------------------------------------------------------------

  @Get('budgets')
  @Can('accounting.read')
  @Contract({
    summary: 'List budgets with actuals and variance',
    tags: ['accounting'],
    params: estateParamSchema,
    response: z.array(budgetSchema),
  })
  listBudgets(@CurrentEstate() estate: EstateAccess) {
    return this.accounting.listBudgets(estate);
  }

  @Post('budgets')
  @Can('accounting.manage')
  @Contract({
    summary: 'Create a draft budget for a financial period',
    tags: ['accounting'],
    params: estateParamSchema,
    body: createBudgetSchema,
    response: budgetSchema,
    status: 201,
    errors: [404, 422],
  })
  createBudget(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createBudgetSchema>,
  ) {
    return this.accounting.createBudget(estate, body);
  }

  @Post('budgets/:id/approve')
  @Can('accounting.payable.approve')
  @HttpCode(200)
  @Contract({
    summary: 'Approve a draft budget (must not be the creator)',
    tags: ['accounting'],
    params: estateResourceParamSchema,
    response: budgetSchema,
    errors: [403, 404, 409],
  })
  approveBudget(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateResourceParamSchema>,
  ) {
    return this.accounting.approveBudget(estate, params.id);
  }

  // ---- Expenses ---------------------------------------------------------------------------------

  @Get('expenses')
  @Can('accounting.read')
  @Contract({
    summary: 'List estate expenses',
    tags: ['accounting'],
    params: estateParamSchema,
    query: expenseListQuerySchema,
    response: expenseSchema,
    paginated: true,
  })
  listExpenses(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof expenseListQuerySchema>,
  ) {
    return this.accounting.listExpenses(estate, query);
  }

  @Post('expenses')
  @Can('accounting.payable.manage')
  @Contract({
    summary: 'Submit an estate expense for approval',
    tags: ['accounting'],
    params: estateParamSchema,
    body: createExpenseSchema,
    response: expenseSchema,
    status: 201,
    errors: [409, 422],
  })
  createExpense(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createExpenseSchema>,
  ) {
    return this.accounting.createExpense(estate, body);
  }

  @Post('expenses/:id/approve')
  @Can('accounting.payable.approve')
  @HttpCode(200)
  @Contract({
    summary: 'Approve and post an expense to the general ledger',
    tags: ['accounting'],
    params: estateResourceParamSchema,
    response: expenseSchema,
    errors: [403, 404, 409],
  })
  approveExpense(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateResourceParamSchema>,
  ) {
    return this.accounting.approveExpense(estate, params.id);
  }

  @Post('expenses/:id/reject')
  @Can('accounting.payable.approve')
  @HttpCode(200)
  @Contract({
    summary: 'Reject a submitted expense',
    tags: ['accounting'],
    params: estateResourceParamSchema,
    body: rejectReasonSchema,
    response: expenseSchema,
    errors: [404, 409],
  })
  rejectExpense(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateResourceParamSchema>,
    @ValidBody() body: z.infer<typeof rejectReasonSchema>,
  ) {
    return this.accounting.rejectExpense(estate, params.id, body.reason);
  }

  // ---- Payables ---------------------------------------------------------------------------------

  @Get('payables')
  @Can('accounting.read')
  @Contract({
    summary: 'List supplier payables',
    tags: ['accounting'],
    params: estateParamSchema,
    query: payableListQuerySchema,
    response: payableSchema,
    paginated: true,
  })
  listPayables(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof payableListQuerySchema>,
  ) {
    return this.accounting.listPayables(estate, query);
  }

  @Post('payables')
  @Can('accounting.payable.manage')
  @Contract({
    summary: 'Record a supplier payable',
    tags: ['accounting'],
    params: estateParamSchema,
    body: createPayableSchema,
    response: payableSchema,
    status: 201,
    errors: [422],
  })
  createPayable(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createPayableSchema>,
  ) {
    return this.accounting.createPayable(estate, body);
  }

  @Post('payables/:id/approve')
  @Can('accounting.payable.approve')
  @HttpCode(200)
  @Contract({
    summary: 'Approve a payable and post it to Accounts Payable',
    tags: ['accounting'],
    params: estateResourceParamSchema,
    response: payableSchema,
    errors: [403, 404, 409],
  })
  approvePayable(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateResourceParamSchema>,
  ) {
    return this.accounting.approvePayable(estate, params.id);
  }

  @Post('payables/:id/payments')
  @Can('accounting.manage')
  @Contract({
    summary: 'Record a payment against an approved payable',
    tags: ['accounting'],
    params: estateResourceParamSchema,
    body: payPayableSchema,
    response: payableSchema,
    status: 201,
    errors: [404, 409, 422],
  })
  payPayable(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateResourceParamSchema>,
    @ValidBody() body: z.infer<typeof payPayableSchema>,
  ) {
    return this.accounting.payPayable(estate, params.id, body);
  }

  // ---- Bank Reconciliation ----------------------------------------------------------------------

  @Get('bank-statements')
  @Can('accounting.read')
  @Contract({
    summary: 'List imported bank statements and reconciliation status',
    tags: ['accounting'],
    params: estateParamSchema,
    response: z.array(bankStatementSchema),
  })
  listBankStatements(@CurrentEstate() estate: EstateAccess) {
    return this.accounting.listBankStatements(estate);
  }

  @Post('bank-statements')
  @Can('accounting.manage')
  @Contract({
    summary: 'Import a bank statement and auto-match against cash journals',
    tags: ['accounting'],
    params: estateParamSchema,
    body: importBankStatementSchema,
    response: bankStatementSchema,
    status: 201,
    errors: [422],
  })
  importBankStatement(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof importBankStatementSchema>,
  ) {
    return this.accounting.importBankStatement(estate, body);
  }

  @Patch('bank-statement-lines/:id')
  @Can('accounting.manage')
  @Contract({
    summary: 'Match, unmatch or ignore a bank statement line',
    tags: ['accounting'],
    params: estateResourceParamSchema,
    body: matchBankLineSchema,
    response: bankStatementLineSchema,
    errors: [404],
  })
  matchBankLine(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateResourceParamSchema>,
    @ValidBody() body: z.infer<typeof matchBankLineSchema>,
  ) {
    return this.accounting.matchBankLine(estate, params.id, body);
  }

  // ---- Financial Statements & Export ------------------------------------------------------------

  @Get('statements/income')
  @Can('accounting.read')
  @Contract({
    summary: 'Income statement (profit and loss) for a date range',
    tags: ['accounting'],
    params: estateParamSchema,
    query: accountingRangeQuerySchema,
    response: incomeStatementSchema,
  })
  incomeStatement(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof accountingRangeQuerySchema>,
  ) {
    return this.accounting.incomeStatement(estate, query);
  }

  @Get('statements/balance-sheet')
  @Can('accounting.read')
  @Contract({
    summary: 'Balance sheet as of a date',
    tags: ['accounting'],
    params: estateParamSchema,
    query: accountingAsOfQuerySchema,
    response: balanceSheetSchema,
  })
  balanceSheet(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof accountingAsOfQuerySchema>,
  ) {
    return this.accounting.balanceSheet(estate, query);
  }

  @Get('statements/cash-flow')
  @Can('accounting.read')
  @Contract({
    summary: 'Cash flow statement for a date range',
    tags: ['accounting'],
    params: estateParamSchema,
    query: accountingRangeQuerySchema,
    response: cashFlowStatementSchema,
  })
  cashFlow(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof accountingRangeQuerySchema>,
  ) {
    return this.accounting.cashFlow(estate, query);
  }

  @Get('export')
  @Can('accounting.read')
  @Contract({
    summary: 'Export journals or trial balance as CSV for external accounting tools',
    tags: ['accounting'],
    params: estateParamSchema,
    query: accountingExportQuerySchema,
    response: accountingExportResponseSchema,
  })
  exportCsv(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof accountingExportQuerySchema>,
  ) {
    return this.accounting.exportCsv(estate, query);
  }
}
