import { Injectable, Logger } from '@nestjs/common';
import type {
  AdCampaignStatus,
  AdCategory,
  AdPlacementKey,
  AdTargeting,
  adCampaignListQuerySchema,
  adLineItemInputSchema,
  createAdCampaignSchema,
  createAdCreativeSchema,
  reviewAdCreativeSchema,
  updateAdCampaignSchema,
} from '@safezone/schemas';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { AdvertiserAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import type { Tx } from '../../common/database/tenant-context';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { PaymentsService } from '../payments/payments.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { AdCache } from './ad-cache';
import { cursorPage, cursorWhere } from './advertisers.service';
import {
  type ApprovalProblem,
  approvalProblems,
  type CampaignAction,
  campaignCan,
  ctr,
  groupByAudience,
  MINIMUM_AUDIENCE,
  scheduleStep,
  statusAfterApproval,
  vatKobo,
} from './domain/advertising';

type CampaignRow = Prisma.AdCampaignGetPayload<object>;
type CreativeRow = Prisma.AdCreativeGetPayload<object>;
type InvoiceRow = Prisma.AdInvoiceGetPayload<object>;

const PROBLEM_MESSAGES: Record<ApprovalProblem, string> = {
  no_arcon_ref: 'Add the ARCON approval reference first',
  advertiser_not_verified: 'Verify the advertiser first',
  advertiser_suspended: 'The advertiser is suspended',
  banned_category: 'This advertiser category cannot be advertised',
  restricted_needs_note: 'Restricted category: add a note explaining why it is allowed',
  no_creatives: 'Add at least one creative',
  creatives_not_approved: 'Every creative must be approved first',
  already_ended: 'The campaign end date has passed',
};

const EVENT_TYPES: Partial<Record<AdCampaignStatus, string>> = {
  approved: 'advertising.campaign.approved',
  active: 'advertising.campaign.activated',
  paused: 'advertising.campaign.paused',
  completed: 'advertising.campaign.completed',
  rejected: 'advertising.campaign.rejected',
  cancelled: 'advertising.campaign.cancelled',
  awaiting_payment: 'advertising.campaign.approved',
};

/** Campaigns, creatives, review, invoices, the schedule job and advertiser reports (ADR-0024). */
@Injectable()
export class CampaignsService {
  private readonly logger = new Logger('AdCampaigns');

  constructor(
    private readonly db: DatabaseService,
    private readonly payments: PaymentsService,
    private readonly tenancy: TenancyService,
    private readonly cache: AdCache,
  ) {}

  private ctx<T>(fn: (tx: Tx) => Promise<T>, userId?: string): Promise<T> {
    return this.db.withContext('advertising', fn, userId ? { userId } : {});
  }

  // ---- Campaigns (Techguard) -----------------------------------------------------------------

  async create(staffId: string, input: z.infer<typeof createAdCampaignSchema>) {
    return this.ctx(async (tx) => {
      const advertiser = await tx.advertiser.findUnique({ where: { id: input.advertiserId } });
      if (!advertiser) throw new NotFoundError('Advertiser not found', 'ADVERTISER_NOT_FOUND');
      const row = await tx.adCampaign.create({
        data: {
          advertiserId: advertiser.id,
          enquiryId: input.enquiryId ?? null,
          title: input.title,
          objective: input.objective,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          budget: BigInt(input.budgetKobo),
          createdBy: staffId,
        },
      });
      await this.replaceLineItems(tx, row.id, input.lineItems);
      if (input.enquiryId)
        await tx.adEnquiry.updateMany({
          where: { id: input.enquiryId },
          data: { status: 'converted_to_campaign', advertiserId: advertiser.id },
        });
      await this.history(tx, row, null, 'draft', staffId, null);
      await this.audit(tx, row.id, 'advertising.campaign.created', staffId, 'create', {
        title: row.title,
      });
      return this.detail(tx, row);
    }, staffId);
  }

  async list(query: z.infer<typeof adCampaignListQuerySchema>) {
    return this.ctx(async (tx) => {
      const rows = await tx.adCampaign.findMany({
        where: {
          ...(query.status ? { status: query.status } : {}),
          ...(query.advertiserId ? { advertiserId: query.advertiserId } : {}),
          ...cursorWhere(query.cursor),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const page = cursorPage(rows, query.limit);
      return { items: await this.views(tx, page.items), nextCursor: page.nextCursor };
    });
  }

  async get(id: string) {
    return this.ctx(async (tx) => this.detail(tx, await this.load(tx, id)));
  }

  /** Edits are allowed until approval; afterwards only the ARCON details can still be filled in. */
  async update(staffId: string, id: string, input: z.infer<typeof updateAdCampaignSchema>) {
    const result = await this.ctx(async (tx) => {
      const row = await this.load(tx, id);
      const editable = ['draft', 'submitted', 'under_review', 'rejected'].includes(row.status);
      const planChange =
        input.title !== undefined ||
        input.objective !== undefined ||
        input.startsAt !== undefined ||
        input.endsAt !== undefined ||
        input.budgetKobo !== undefined ||
        input.lineItems !== undefined;
      if (planChange && !editable)
        throw new ConflictError(
          'CAMPAIGN_LOCKED',
          'An approved campaign cannot be changed; cancel it instead',
        );
      const startsAt = input.startsAt ? new Date(input.startsAt) : row.startsAt;
      const endsAt = input.endsAt ? new Date(input.endsAt) : row.endsAt;
      if (endsAt <= startsAt)
        throw new DomainError('CAMPAIGN_DATES_INVALID', 'The end must be after the start', 422);
      const updated = await tx.adCampaign.update({
        where: { id: row.id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.objective !== undefined ? { objective: input.objective } : {}),
          startsAt,
          endsAt,
          ...(input.budgetKobo !== undefined ? { budget: BigInt(input.budgetKobo) } : {}),
          ...(input.arconApprovalRef !== undefined
            ? { arconApprovalRef: input.arconApprovalRef }
            : {}),
          ...(input.arconApprovalFileId !== undefined
            ? { arconApprovalFileId: input.arconApprovalFileId }
            : {}),
          version: { increment: 1 },
        },
      });
      if (input.lineItems) await this.replaceLineItems(tx, row.id, input.lineItems);
      await this.audit(tx, row.id, 'advertising.campaign.updated', staffId, 'update', {
        fields: Object.keys(input),
      });
      return this.detail(tx, updated);
    }, staffId);
    this.cache.purge();
    return result;
  }

  /** submit, reject, pause, resume and cancel by Techguard (approve has its own gates). */
  async transition(
    staffId: string,
    id: string,
    action: Exclude<CampaignAction, 'approve' | 'mark_paid' | 'schedule' | 'activate' | 'complete'>,
    reason: string | undefined,
  ) {
    const TO: Record<typeof action, AdCampaignStatus> = {
      submit: 'under_review',
      reject: 'rejected',
      pause: 'paused',
      resume: 'active',
      cancel: 'cancelled',
    };
    const result = await this.ctx(async (tx) => {
      const row = await this.load(tx, id);
      if (!campaignCan(action, row.status as AdCampaignStatus))
        throw new ConflictError(
          'CAMPAIGN_STATUS_CONFLICT',
          'The campaign cannot do that in its current status',
        );
      if (action === 'resume' && new Date() >= row.endsAt)
        throw new ConflictError('CAMPAIGN_ENDED', 'The campaign end date has passed');
      if (action === 'submit') {
        const creatives = await tx.adCreative.count({
          where: { campaignId: row.id, active: true },
        });
        if (creatives === 0)
          throw new DomainError(
            'CREATIVE_REQUIRED',
            'Add at least one creative before review',
            422,
          );
      }
      const to = TO[action];
      const updated = await this.move(tx, row, to, staffId, reason ?? null, {
        ...(action === 'reject' ? { rejectionReason: reason ?? null } : {}),
      });
      return this.detail(tx, updated);
    }, staffId);
    this.cache.purge();
    return result;
  }

  /** Approval (rules 2, 4, 12): every gate must pass; then it waits for payment unless paid or on credit. */
  async approve(staffId: string, id: string, restrictedNote: string | undefined) {
    const result = await this.ctx(async (tx) => {
      const row = await this.load(tx, id);
      if (!campaignCan('approve', row.status as AdCampaignStatus))
        throw new ConflictError(
          'CAMPAIGN_STATUS_CONFLICT',
          'Only campaigns in review can be approved',
        );
      const advertiser = await tx.advertiser.findUniqueOrThrow({ where: { id: row.advertiserId } });
      const creatives = await tx.adCreative.findMany({
        where: { campaignId: row.id, active: true },
      });
      const note = restrictedNote ?? row.restrictedNote;
      const problems = approvalProblems({
        arconRef: row.arconApprovalRef,
        advertiser: {
          verificationStatus: advertiser.verificationStatus,
          status: advertiser.status,
          category: advertiser.category as AdCategory,
        },
        restrictedNote: note,
        creativeStatuses: creatives.map((c) => c.reviewStatus),
        endsAt: row.endsAt,
        now: new Date(),
      });
      if (problems.length > 0)
        throw new DomainError(
          `APPROVAL_BLOCKED_${problems[0]?.toUpperCase()}`,
          problems.map((p) => PROBLEM_MESSAGES[p]).join('. '),
          422,
        );
      const settled = await this.settled(tx, row);
      const updated = await this.move(tx, row, statusAfterApproval(settled), staffId, null, {
        approvedBy: staffId,
        approvedAt: new Date(),
        restrictedNote: note ?? null,
        rejectionReason: null,
      });
      return this.detail(tx, updated);
    }, staffId);
    this.cache.purge();
    return result;
  }

  /** An approved credit arrangement stands in for payment (rule 4); it is audited with who and why. */
  async approveCredit(staffId: string, id: string, note: string) {
    return this.ctx(async (tx) => {
      const row = await this.load(tx, id);
      if (['completed', 'cancelled'].includes(row.status))
        throw new ConflictError('CAMPAIGN_STATUS_CONFLICT', 'The campaign has ended');
      let updated = await tx.adCampaign.update({
        where: { id: row.id },
        data: {
          creditApprovedBy: staffId,
          creditApprovedAt: new Date(),
          creditNote: note,
          version: { increment: 1 },
        },
      });
      await this.audit(tx, row.id, 'advertising.campaign.credit_approved', staffId, 'credit', {
        note,
      });
      if (updated.status === 'awaiting_payment')
        updated = await this.move(
          tx,
          updated,
          'approved',
          staffId,
          'Credit arrangement approved',
          {},
        );
      return this.detail(tx, updated);
    }, staffId);
  }

  // ---- Creatives -----------------------------------------------------------------------------

  async addCreative(
    actor: { userId: string; kind: 'platform_staff' | 'user' },
    campaignId: string,
    input: z.infer<typeof createAdCreativeSchema>,
    advertiserId?: string,
    supersedesId?: string,
  ) {
    const result = await this.ctx(async (tx) => {
      const campaign = await this.load(tx, campaignId);
      if (advertiserId && campaign.advertiserId !== advertiserId)
        throw new NotFoundError('Campaign not found', 'AD_CAMPAIGN_NOT_FOUND');
      if (['completed', 'cancelled'].includes(campaign.status))
        throw new ConflictError('CAMPAIGN_STATUS_CONFLICT', 'The campaign has ended');
      let version = 1;
      if (supersedesId) {
        const previous = await tx.adCreative.findFirst({
          where: { id: supersedesId, campaignId, active: true },
        });
        if (!previous) throw new NotFoundError('Creative not found', 'AD_CREATIVE_NOT_FOUND');
        version = previous.version + 1;
        await tx.adCreative.update({ where: { id: previous.id }, data: { active: false } });
      }
      const row = await tx.adCreative.create({
        data: {
          campaignId,
          type: input.type,
          imageFileId: input.imageFileId ?? null,
          headline: input.headline,
          body: input.body ?? null,
          cta: input.cta,
          destinationUrl: input.destinationUrl,
          version,
          supersedesId: supersedesId ?? null,
          createdBy: actor.userId,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'advertising.creative.submitted',
          estateId: null,
          aggregateType: 'ad_creative',
          aggregateId: row.id,
          payload: { creativeId: row.id, campaignId },
          audit: {
            actorType: actor.kind,
            actorId: actor.userId,
            action: supersedesId ? 'advertising.creative.revise' : 'advertising.creative.create',
            resourceType: 'ad_creative',
            resourceId: row.id,
            after: { headline: row.headline, destinationUrl: row.destinationUrl, version },
          },
        },
      ]);
      return creativeView(row);
    }, actor.userId);
    // A changed creative (rule 13) needs review again; the old version stops serving at once.
    if (supersedesId) this.cache.purge();
    return result;
  }

  async reviewCreative(
    staffId: string,
    creativeId: string,
    input: z.infer<typeof reviewAdCreativeSchema>,
  ) {
    const result = await this.ctx(async (tx) => {
      const row = await tx.adCreative.findUnique({ where: { id: creativeId } });
      if (!row || !row.active)
        throw new NotFoundError('Creative not found', 'AD_CREATIVE_NOT_FOUND');
      const updated = await tx.adCreative.update({
        where: { id: row.id },
        data: {
          reviewStatus: input.decision,
          reviewNotes: input.notes ?? null,
          reviewedBy: staffId,
          reviewedAt: new Date(),
        },
      });
      await appendOutboxEvents(tx, [
        {
          type:
            input.decision === 'approved'
              ? 'advertising.creative.approved'
              : 'advertising.creative.rejected',
          estateId: null,
          aggregateType: 'ad_creative',
          aggregateId: row.id,
          payload: { creativeId: row.id, campaignId: row.campaignId, decision: input.decision },
          audit: {
            actorType: 'platform_staff',
            actorId: staffId,
            action: 'advertising.creative.review',
            resourceType: 'ad_creative',
            resourceId: row.id,
            before: { reviewStatus: row.reviewStatus },
            after: { reviewStatus: input.decision },
            reason: input.notes ?? null,
          },
        },
      ]);
      return creativeView(updated);
    }, staffId);
    this.cache.purge();
    return result;
  }

  // ---- Invoices (paid on Safezone's own account) ---------------------------------------------

  async createInvoice(staffId: string, campaignId: string) {
    return this.ctx(async (tx) => {
      const campaign = await this.load(tx, campaignId);
      if (['cancelled', 'rejected'].includes(campaign.status))
        throw new ConflictError('CAMPAIGN_STATUS_CONFLICT', 'This campaign cannot be invoiced');
      const open = await tx.adInvoice.findFirst({
        where: { campaignId, status: { in: ['issued', 'paid'] } },
      });
      if (open) throw new ConflictError('INVOICE_EXISTS', 'This campaign already has an invoice');
      const amount = Number(campaign.budget);
      const vat = vatKobo(amount);
      const [seq] = await tx.$queryRaw<
        { n: bigint }[]
      >`select nextval('platform.ad_invoice_number_seq') as n`;
      const year = new Date().getUTCFullYear();
      const row = await tx.adInvoice.create({
        data: {
          advertiserId: campaign.advertiserId,
          campaignId,
          number: `AD-${year}-${String(seq?.n ?? 0).padStart(6, '0')}`,
          amount: BigInt(amount),
          vat: BigInt(vat),
          total: BigInt(amount + vat),
          createdBy: staffId,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'advertising.invoice.issued',
          estateId: null,
          aggregateType: 'ad_invoice',
          aggregateId: row.id,
          payload: { invoiceId: row.id, campaignId },
          audit: {
            actorType: 'platform_staff',
            actorId: staffId,
            action: 'advertising.invoice.issue',
            resourceType: 'ad_invoice',
            resourceId: row.id,
            after: { number: row.number, total: amount + vat },
          },
        },
      ]);
      return invoiceView(row);
    }, staffId);
  }

  async invoices(campaignId: string, advertiserId?: string) {
    return this.ctx(async (tx) => {
      const campaign = await this.load(tx, campaignId);
      if (advertiserId && campaign.advertiserId !== advertiserId)
        throw new NotFoundError('Campaign not found', 'AD_CAMPAIGN_NOT_FOUND');
      return (
        await tx.adInvoice.findMany({ where: { campaignId }, orderBy: { createdAt: 'desc' } })
      ).map(invoiceView);
    });
  }

  async payInvoice(access: AdvertiserAccess, invoiceId: string, callbackUrl: string | undefined) {
    const invoice = await this.ctx(async (tx) => {
      const row = await tx.adInvoice.findFirst({
        where: { id: invoiceId, advertiserId: access.advertiserId },
      });
      if (!row) throw new NotFoundError('Invoice not found', 'AD_INVOICE_NOT_FOUND');
      if (row.status !== 'issued')
        throw new ConflictError('INVOICE_NOT_PAYABLE', 'This invoice is not open');
      if (row.paymentReference) {
        const result = await this.payments.processReference(row.paymentReference);
        if (result.outcome === 'ad_paid') {
          await this.handlePaid(result.reference, result.amountKobo);
          throw new ConflictError('INVOICE_NOT_PAYABLE', 'This invoice is already paid');
        }
      }
      const reference = `sz_ad_${row.id.replace(/-/g, '')}_${Date.now().toString(36)}`;
      await tx.adInvoice.update({ where: { id: row.id }, data: { paymentReference: reference } });
      return { ...row, paymentReference: reference };
    });
    const checkout = await this.payments.startAdCharge({
      payerUserId: access.userId,
      reference: invoice.paymentReference,
      amountKobo: Number(invoice.total),
      callbackUrl,
      metadata: { purpose: 'ad_invoice', invoiceId: invoice.id },
    });
    return {
      invoiceId: invoice.id,
      totalKobo: Number(invoice.total),
      authorizationUrl: checkout.authorizationUrl,
    };
  }

  async verifyInvoice(access: AdvertiserAccess, invoiceId: string) {
    const row = await this.ctx((tx) =>
      tx.adInvoice.findFirst({ where: { id: invoiceId, advertiserId: access.advertiserId } }),
    );
    if (!row) throw new NotFoundError('Invoice not found', 'AD_INVOICE_NOT_FOUND');
    if (row.status === 'issued' && row.paymentReference) {
      const result = await this.payments.processReference(row.paymentReference);
      if (result.outcome === 'ad_paid') await this.handlePaid(result.reference, result.amountKobo);
    }
    return this.ctx(async (tx) =>
      invoiceView(await tx.adInvoice.findUniqueOrThrow({ where: { id: invoiceId } })),
    );
  }

  /** A verified ad invoice charge. A charge that matches no open invoice, or the wrong amount, is refunded. */
  async handlePaid(reference: string, amountKobo: number): Promise<void> {
    const outcome = await this.ctx(async (tx) => {
      const invoice = await tx.adInvoice.findUnique({ where: { paymentReference: reference } });
      if (!invoice) return 'orphan' as const;
      if (invoice.status === 'paid') return 'duplicate' as const;
      if (invoice.status !== 'issued' || Number(invoice.total) !== amountKobo)
        return 'mismatch' as const;
      await tx.adInvoice.update({
        where: { id: invoice.id },
        data: { status: 'paid', paidAt: new Date() },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'advertising.invoice.paid',
          estateId: null,
          aggregateType: 'ad_invoice',
          aggregateId: invoice.id,
          payload: { invoiceId: invoice.id, campaignId: invoice.campaignId, amountKobo },
          audit: {
            actorType: 'provider_webhook',
            action: 'advertising.invoice.pay',
            resourceType: 'ad_invoice',
            resourceId: invoice.id,
            after: { total: amountKobo },
          },
        },
      ]);
      const campaign = await tx.adCampaign.findUniqueOrThrow({ where: { id: invoice.campaignId } });
      if (campaign.status === 'awaiting_payment')
        await this.move(tx, campaign, 'approved', null, 'Invoice paid', {});
      return 'paid' as const;
    });
    if (outcome === 'orphan' || outcome === 'mismatch') {
      this.logger.error({ msg: 'ad charge refunded', reason: outcome });
      await this.payments.refundPlatformCharge(reference, amountKobo);
    }
    if (outcome === 'paid') this.cache.purge();
  }

  // ---- Schedule job --------------------------------------------------------------------------

  /** Every minute (ads queue): approved campaigns are scheduled or go live; ended ones complete (rule 8). */
  async sweep(now = new Date()): Promise<number> {
    const changed = await this.ctx(async (tx) => {
      const rows = await tx.adCampaign.findMany({
        where: { status: { in: ['approved', 'scheduled', 'active', 'paused'] } },
        take: 500,
      });
      let count = 0;
      for (const row of rows) {
        const step = scheduleStep(
          { status: row.status as AdCampaignStatus, startsAt: row.startsAt, endsAt: row.endsAt },
          now,
        );
        if (!step) continue;
        const to: AdCampaignStatus =
          step === 'activate' ? 'active' : step === 'schedule' ? 'scheduled' : 'completed';
        if (to === row.status) continue;
        await this.move(tx, row, to, null, null, {});
        count += 1;
      }
      return count;
    });
    if (changed > 0) this.cache.purge();
    return changed;
  }

  // ---- Advertiser views ----------------------------------------------------------------------

  async advertiserCampaigns(access: AdvertiserAccess) {
    return this.ctx(async (tx) =>
      this.views(
        tx,
        await tx.adCampaign.findMany({
          where: { advertiserId: access.advertiserId },
          orderBy: { createdAt: 'desc' },
          take: 200,
        }),
      ),
    );
  }

  async advertiserCampaign(access: AdvertiserAccess, id: string) {
    return this.ctx(async (tx) => {
      const row = await this.load(tx, id);
      if (row.advertiserId !== access.advertiserId)
        throw new NotFoundError('Campaign not found', 'AD_CAMPAIGN_NOT_FOUND');
      return this.detail(tx, row);
    });
  }

  /** Aggregate report (rule 5): totals, a daily series, and estates with at least 200 unique users. */
  async report(access: AdvertiserAccess | null, id: string) {
    const data = await this.ctx(async (tx) => {
      const row = await this.load(tx, id);
      if (access && row.advertiserId !== access.advertiserId)
        throw new NotFoundError('Campaign not found', 'AD_CAMPAIGN_NOT_FOUND');
      const [totals] = await tx.$queryRaw<{ impressions: bigint; clicks: bigint; reach: bigint }[]>`
        select (select count(*) from platform.ad_impressions where campaign_id = ${row.id}::uuid) as impressions,
               (select count(*) from platform.ad_clicks where campaign_id = ${row.id}::uuid) as clicks,
               (select count(distinct user_hash) from platform.ad_impressions where campaign_id = ${row.id}::uuid) as reach`;
      const daily = await tx.$queryRaw<{ day: string; impressions: bigint; clicks: bigint }[]>`
        select d.day, coalesce(i.n, 0) as impressions, coalesce(c.n, 0) as clicks
          from (select distinct to_char(at at time zone 'Africa/Lagos', 'YYYY-MM-DD') as day
                  from platform.ad_impressions where campaign_id = ${row.id}::uuid) d
          left join (select to_char(at at time zone 'Africa/Lagos', 'YYYY-MM-DD') as day, count(*) as n
                       from platform.ad_impressions where campaign_id = ${row.id}::uuid group by 1) i on i.day = d.day
          left join (select to_char(at at time zone 'Africa/Lagos', 'YYYY-MM-DD') as day, count(*) as n
                       from platform.ad_clicks where campaign_id = ${row.id}::uuid group by 1) c on c.day = d.day
         order by d.day`;
      const estates = await tx.$queryRaw<
        { estate_id: string; impressions: bigint; clicks: bigint; unique_users: bigint }[]
      >`
        select i.estate_id, count(*) as impressions,
               (select count(*) from platform.ad_clicks c where c.campaign_id = ${row.id}::uuid and c.estate_id = i.estate_id) as clicks,
               count(distinct i.user_hash) as unique_users
          from platform.ad_impressions i where i.campaign_id = ${row.id}::uuid group by i.estate_id`;
      return { row, totals, daily, estates };
    });
    const names = await this.tenancy.estateNamesByIds(data.estates.map((e) => e.estate_id));
    const impressions = Number(data.totals?.impressions ?? 0n);
    const clicks = Number(data.totals?.clicks ?? 0n);
    return {
      campaignId: data.row.id,
      from: data.row.startsAt.toISOString(),
      to: data.row.endsAt.toISOString(),
      impressions,
      clicks,
      ctr: ctr(impressions, clicks),
      uniqueReachEstimate: Number(data.totals?.reach ?? 0n),
      daily: data.daily.map((d) => ({
        day: d.day,
        impressions: Number(d.impressions),
        clicks: Number(d.clicks),
      })),
      byEstate: groupByAudience(
        data.estates.map((e) => ({
          estateName: names.get(e.estate_id) ?? 'Estate',
          impressions: Number(e.impressions),
          clicks: Number(e.clicks),
          uniqueUsers: Number(e.unique_users),
        })),
        'Other estates',
      ),
      minimumAudience: MINIMUM_AUDIENCE,
    };
  }

  // ---- Helpers -------------------------------------------------------------------------------

  private async settled(tx: Tx, row: CampaignRow): Promise<boolean> {
    if (row.creditApprovedAt) return true;
    const paid = await tx.adInvoice.count({ where: { campaignId: row.id, status: 'paid' } });
    return paid > 0;
  }

  private async move(
    tx: Tx,
    row: CampaignRow,
    to: AdCampaignStatus,
    actorId: string | null,
    note: string | null,
    extra: Prisma.AdCampaignUpdateManyMutationInput,
  ): Promise<CampaignRow> {
    const result = await tx.adCampaign.updateMany({
      where: { id: row.id, version: row.version },
      data: { ...extra, status: to, version: { increment: 1 } },
    });
    if (result.count !== 1)
      throw new ConflictError('CAMPAIGN_CHANGED', 'The campaign changed. Refresh and try again.');
    const updated = await tx.adCampaign.findUniqueOrThrow({ where: { id: row.id } });
    await this.history(tx, updated, row.status, to, actorId, note);
    await appendOutboxEvents(tx, [
      {
        type: EVENT_TYPES[to] ?? 'advertising.campaign.updated',
        estateId: null,
        aggregateType: 'ad_campaign',
        aggregateId: row.id,
        payload: { campaignId: row.id, from: row.status, to },
        audit: {
          actorType: actorId ? 'platform_staff' : 'system',
          actorId,
          action: `advertising.campaign.${to}`,
          resourceType: 'ad_campaign',
          resourceId: row.id,
          before: { status: row.status },
          after: { status: to },
          reason: note,
        },
      },
    ]);
    return updated;
  }

  private async history(
    tx: Tx,
    row: CampaignRow,
    from: string | null,
    to: string,
    actorId: string | null,
    note: string | null,
  ) {
    await tx.adCampaignEvent.create({
      data: { campaignId: row.id, fromStatus: from, toStatus: to, actorId, note },
    });
  }

  private async audit(
    tx: Tx,
    id: string,
    type: string,
    staffId: string,
    verb: string,
    after: Prisma.InputJsonValue,
  ) {
    await appendOutboxEvents(tx, [
      {
        type,
        estateId: null,
        aggregateType: 'ad_campaign',
        aggregateId: id,
        payload: { campaignId: id },
        audit: {
          actorType: 'platform_staff',
          actorId: staffId,
          action: `advertising.campaign.${verb}`,
          resourceType: 'ad_campaign',
          resourceId: id,
          after,
        },
      },
    ]);
  }

  private async replaceLineItems(
    tx: Tx,
    campaignId: string,
    items: z.infer<typeof adLineItemInputSchema>[],
  ) {
    const placements = await tx.adPlacement.findMany({
      where: { key: { in: items.map((i) => i.placementKey) }, active: true },
      select: { key: true },
    });
    const active = new Set(placements.map((p) => p.key));
    const missing = items.find((i) => !active.has(i.placementKey));
    if (missing)
      throw new DomainError(
        'AD_PLACEMENT_INACTIVE',
        `Placement ${missing.placementKey} is not available`,
        422,
      );
    await tx.adLineItem.deleteMany({ where: { campaignId } });
    await tx.adLineItem.createMany({
      data: items.map((i) => ({
        campaignId,
        placementKey: i.placementKey,
        targeting: i.targeting as Prisma.InputJsonValue,
        weight: i.weight,
        frequencyCapPerDay: i.frequencyCapPerDay ?? null,
      })),
    });
  }

  async load(tx: Tx, id: string): Promise<CampaignRow> {
    const row = await tx.adCampaign.findUnique({ where: { id } });
    if (!row) throw new NotFoundError('Campaign not found', 'AD_CAMPAIGN_NOT_FOUND');
    return row;
  }

  private async views(tx: Tx, rows: CampaignRow[]) {
    const advertisers = await tx.advertiser.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.advertiserId))] } },
      select: { id: true, name: true },
    });
    const paid = await tx.adInvoice.findMany({
      where: { campaignId: { in: rows.map((r) => r.id) }, status: 'paid' },
      select: { campaignId: true },
    });
    const names = new Map(advertisers.map((a) => [a.id, a.name]));
    const paidSet = new Set(paid.map((p) => p.campaignId));
    return rows.map((row) =>
      campaignView(row, names.get(row.advertiserId) ?? '', paidSet.has(row.id)),
    );
  }

  private async detail(tx: Tx, row: CampaignRow) {
    const [base] = await this.views(tx, [row]);
    const [lineItems, creatives] = await Promise.all([
      tx.adLineItem.findMany({ where: { campaignId: row.id }, orderBy: { createdAt: 'asc' } }),
      tx.adCreative.findMany({
        where: { campaignId: row.id, active: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    if (!base) throw new Error('campaign view');
    return {
      ...base,
      lineItems: lineItems.map((l) => ({
        id: l.id,
        placementKey: l.placementKey as AdPlacementKey,
        targeting: normaliseTargeting(l.targeting),
        weight: l.weight,
        frequencyCapPerDay: l.frequencyCapPerDay,
      })),
      creatives: creatives.map(creativeView),
      restrictedNote: row.restrictedNote,
      rejectionReason: row.rejectionReason,
    };
  }

  /** For advertiser-side creative edits: the campaign must belong to the caller and not be over. */
  assertAdvertiserCanEdit(access: AdvertiserAccess) {
    if (access.advertiserStatus !== 'active')
      throw new ForbiddenError('Your advertiser account is suspended', 'ADVERTISER_SUSPENDED');
  }
}

export function normaliseTargeting(value: unknown): AdTargeting {
  const t = (value ?? {}) as Partial<AdTargeting>;
  return {
    scope: t.scope === 'estates' || t.scope === 'states' ? t.scope : 'all',
    estateIds: Array.isArray(t.estateIds) ? t.estateIds : [],
    states: Array.isArray(t.states) ? t.states : [],
  };
}

function campaignView(row: CampaignRow, advertiserName: string, paid: boolean) {
  return {
    id: row.id,
    advertiserId: row.advertiserId,
    advertiserName,
    title: row.title,
    objective: row.objective,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    budgetKobo: Number(row.budget),
    status: row.status as AdCampaignStatus,
    arconApprovalRef: row.arconApprovalRef,
    paid,
    creditApproved: row.creditApprovedAt !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function creativeView(row: CreativeRow) {
  return {
    id: row.id,
    campaignId: row.campaignId,
    type: row.type as 'image_banner',
    imageFileId: row.imageFileId,
    headline: row.headline,
    body: row.body,
    cta: row.cta,
    destinationUrl: row.destinationUrl,
    version: row.version,
    reviewStatus: row.reviewStatus as 'pending',
    reviewNotes: row.reviewNotes,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}

function invoiceView(row: InvoiceRow) {
  return {
    id: row.id,
    campaignId: row.campaignId,
    number: row.number,
    amountKobo: Number(row.amount),
    vatKobo: Number(row.vat),
    totalKobo: Number(row.total),
    status: row.status as 'issued',
    paidAt: row.paidAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
