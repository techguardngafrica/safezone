import { Injectable } from '@nestjs/common';
import type {
  applicationListQuerySchema,
  ApplicationView,
  EstateApplication,
  resubmitApplicationSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import { DatabaseService } from '../../../common/database/database.service';
import type { Tx } from '../../../common/database/tenant-context';
import { ConflictError, DomainError, NotFoundError } from '../../../common/errors/domain-error';
import { uuidv7 } from '../../../common/ids/uuidv7';
import { appendOutboxEvents } from '../../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor';
import { AuthzService } from '../../authz/authz.service';
import { FilesService } from '../../files/files.service';
import { IdentityService } from '../../identity/identity.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { type ApplicationAction, nextApplicationStatus } from '../domain/application-status';
import { generateEstateCode, generateEstateSlug } from '../domain/codes';
import { type DuplicateCandidate, findDuplicates } from '../domain/duplicates';

/** An applicant may have this many applications open at once (stops spam, allows a developer with several estates). */
const MAX_OPEN_APPLICATIONS = 3;
const MAX_DOCUMENTS = 10;
const UNUSABLE_FILE_STATUSES = new Set(['infected', 'rejected', 'error', 'awaiting_upload']);

type ApplicationRow = Prisma.EstateApplicationGetPayload<{ include: { documents: true } }>;

const cursorSchema = z.object({ submittedAt: z.iso.datetime(), id: z.uuid() });

export function toApplicationView(row: ApplicationRow): ApplicationView {
  return {
    id: row.id,
    status: row.status as ApplicationView['status'],
    representative: {
      fullName: row.representativeName,
      email: row.representativeEmail,
      role: row.representativeRole,
    },
    estate: {
      name: row.estateName,
      type: row.estateType as ApplicationView['estate']['type'],
      address: row.address,
      state: row.state,
      lga: row.lga,
      location:
        row.latitude !== null && row.longitude !== null
          ? { lat: row.latitude, lng: row.longitude }
          : null,
      unitsEstimate: row.unitsEstimate,
      gatesEstimate: row.gatesEstimate,
    },
    documents: row.documents.map((document) => ({
      fileId: document.fileId,
      docType: document.docType,
    })),
    decisionReason: row.decisionReason,
    estateId: row.estateId,
    submittedAt: row.submittedAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    version: row.version,
  };
}

/** Prisma unique-constraint violation (estate code or slug collision). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Self-service onboarding (tenancy.md §4.1): applicant submits, Techguard reviews, approval creates the
 * estate, the applicant's membership and their Estate Administrator role in one transaction.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly files: FilesService,
    private readonly authz: AuthzService,
    private readonly identity: IdentityService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- Applicant -----------------------------------------------------------------------------

  async submit(userId: string, input: EstateApplication): Promise<ApplicationView> {
    const documentIds = [...new Set(input.documentFileIds)];
    await this.assertUsableDocuments(userId, documentIds);
    return this.db.withContext(
      'tenancy',
      async (tx) => {
        const open = await tx.estateApplication.count({
          where: {
            applicantUserId: userId,
            status: { in: ['submitted', 'under_review', 'info_requested'] },
          },
        });
        if (open >= MAX_OPEN_APPLICATIONS) {
          throw new ConflictError(
            'TOO_MANY_OPEN_APPLICATIONS',
            'You already have applications waiting for review. Wait for a decision before applying again.',
          );
        }
        const id = uuidv7();
        await tx.estateApplication.create({
          data: {
            id,
            applicantUserId: userId,
            representativeName: input.representative.fullName,
            representativeEmail: input.representative.email,
            representativeRole: input.representative.role,
            estateName: input.estate.name,
            estateType: input.estate.type,
            address: input.estate.address,
            state: input.estate.state,
            lga: input.estate.lga,
            latitude: input.estate.location?.lat ?? null,
            longitude: input.estate.location?.lng ?? null,
            unitsEstimate: input.estate.unitsEstimate,
            gatesEstimate: input.estate.gatesEstimate,
            documents: { create: documentIds.map((fileId) => ({ fileId })) },
          },
        });
        await appendOutboxEvents(tx, [
          {
            type: 'tenancy.application.submitted',
            estateId: null,
            aggregateType: 'estate_application',
            aggregateId: id,
            payload: { applicationId: id },
            audit: {
              actorType: 'user',
              actorId: userId,
              action: 'tenancy.application.submit',
              resourceType: 'estate_application',
              resourceId: id,
            },
          },
        ]);
        await this.notifications.request(tx, {
          intent: 'onboarding.application_received',
          userIds: [userId],
          estateId: null,
          data: { estateName: input.estate.name },
          dedupeKey: `application:${id}:received`,
        });
        return toApplicationView(await this.load(tx, id));
      },
      { userId },
    );
  }

  async mine(userId: string): Promise<ApplicationView[]> {
    const rows = await this.db.withContext('tenancy', (tx) =>
      tx.estateApplication.findMany({
        where: { applicantUserId: userId },
        include: { documents: true },
        orderBy: { submittedAt: 'desc' },
        take: 20,
      }),
    );
    return rows.map(toApplicationView);
  }

  /** Applicant answers an information request with more documents and goes back into the queue. */
  async resubmit(
    userId: string,
    applicationId: string,
    input: z.infer<typeof resubmitApplicationSchema>,
  ): Promise<ApplicationView> {
    const documentIds = [...new Set(input.documentFileIds)];
    await this.assertUsableDocuments(userId, documentIds, true);
    return this.db.withContext(
      'tenancy',
      async (tx) => {
        const row = await this.ownApplication(tx, userId, applicationId);
        if (row.documents.length + documentIds.length > MAX_DOCUMENTS) {
          throw new DomainError(
            'TOO_MANY_DOCUMENTS',
            `Attach at most ${MAX_DOCUMENTS} documents`,
            422,
          );
        }
        await this.transition(tx, row, 'resubmit', { decisionReason: null });
        const existing = new Set(row.documents.map((document) => document.fileId));
        const added = documentIds.filter((fileId) => !existing.has(fileId));
        if (added.length > 0) {
          await tx.estateApplicationDocument.createMany({
            data: added.map((fileId) => ({ applicationId, fileId })),
          });
        }
        await appendOutboxEvents(tx, [
          {
            type: 'tenancy.application.resubmitted',
            estateId: null,
            aggregateType: 'estate_application',
            aggregateId: applicationId,
            payload: { applicationId, addedDocuments: added.length },
            audit: {
              actorType: 'user',
              actorId: userId,
              action: 'tenancy.application.resubmit',
              resourceType: 'estate_application',
              resourceId: applicationId,
              ...(input.note ? { reason: input.note } : {}),
            },
          },
        ]);
        return toApplicationView(await this.load(tx, applicationId));
      },
      { userId },
    );
  }

  async withdraw(userId: string, applicationId: string): Promise<ApplicationView> {
    return this.db.withContext(
      'tenancy',
      async (tx) => {
        const row = await this.ownApplication(tx, userId, applicationId);
        await this.transition(tx, row, 'withdraw', { decidedAt: new Date() });
        await appendOutboxEvents(tx, [
          {
            type: 'tenancy.application.withdrawn',
            estateId: null,
            aggregateType: 'estate_application',
            aggregateId: applicationId,
            payload: { applicationId },
            audit: {
              actorType: 'user',
              actorId: userId,
              action: 'tenancy.application.withdraw',
              resourceType: 'estate_application',
              resourceId: applicationId,
            },
          },
        ]);
        return toApplicationView(await this.load(tx, applicationId));
      },
      { userId },
    );
  }

  // ---- Reviewer (Techguard) ------------------------------------------------------------------

  async list(query: z.infer<typeof applicationListQuerySchema>) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (value): value is z.infer<typeof cursorSchema> => cursorSchema.safeParse(value).success,
        )
      : undefined;
    const rows = await this.db.withContext('tenancy', (tx) =>
      tx.estateApplication.findMany({
        where: {
          ...(query.status ? { status: query.status } : {}),
          ...(after
            ? {
                OR: [
                  { submittedAt: { gt: new Date(after.submittedAt) } },
                  { submittedAt: new Date(after.submittedAt), id: { gt: after.id } },
                ],
              }
            : {}),
        },
        include: { documents: true },
        // Oldest first: the review queue is worked in order.
        orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
      }),
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toApplicationView),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ submittedAt: last.submittedAt.toISOString(), id: last.id })
          : null,
    };
  }

  /** Full reviewer view with the applicant's phone and the duplicate check (tenancy.md §7.1). */
  async review(applicationId: string) {
    const { row, candidates } = await this.db.withContext('tenancy', async (tx) => {
      const application = await this.load(tx, applicationId);
      const [estates, applications] = await Promise.all([
        tx.estate.findMany({
          where: { state: { equals: application.state, mode: 'insensitive' } },
          select: { id: true, name: true, state: true },
          take: 2000,
        }),
        tx.estateApplication.findMany({
          where: {
            id: { not: application.id },
            status: { in: ['submitted', 'under_review', 'info_requested'] },
            state: { equals: application.state, mode: 'insensitive' },
          },
          select: { id: true, estateName: true, state: true, latitude: true, longitude: true },
          take: 2000,
        }),
      ]);
      const list: DuplicateCandidate[] = [
        ...estates.map((estate) => ({
          kind: 'estate' as const,
          id: estate.id,
          name: estate.name,
          state: estate.state,
          location: null,
        })),
        ...applications.map((other) => ({
          kind: 'application' as const,
          id: other.id,
          name: other.estateName,
          state: other.state,
          location:
            other.latitude !== null && other.longitude !== null
              ? { lat: other.latitude, lng: other.longitude }
              : null,
        })),
      ];
      return { row: application, candidates: list };
    });
    const contacts = await this.identity.contactsOf([row.applicantUserId]);
    const view = toApplicationView(row);
    return {
      ...view,
      applicantUserId: row.applicantUserId,
      applicantPhone: contacts.get(row.applicantUserId)?.phone ?? '',
      reviewerId: row.reviewerId,
      duplicates: findDuplicates(
        { name: row.estateName, state: row.state, location: view.estate.location },
        candidates,
      ),
    };
  }

  async startReview(staffId: string, applicationId: string): Promise<ApplicationView> {
    return this.decide(staffId, applicationId, 'start_review', null);
  }

  async requestInfo(
    staffId: string,
    applicationId: string,
    reason: string,
  ): Promise<ApplicationView> {
    return this.decide(staffId, applicationId, 'request_info', reason);
  }

  async reject(staffId: string, applicationId: string, reason: string): Promise<ApplicationView> {
    return this.decide(staffId, applicationId, 'reject', reason);
  }

  /**
   * Approval (tenancy.md §4.1 step 4, §7.2–7.3): needs at least one clean proof-of-authority document.
   * Creates the estate (status approved, free core plan), the applicant's active membership and exactly
   * one Estate Administrator assignment, all in one transaction.
   */
  async approve(staffId: string, applicationId: string): Promise<ApplicationView> {
    const { documents, status } = await this.db.withContext('tenancy', async (tx) => {
      const row = await this.load(tx, applicationId);
      return { documents: row.documents, status: row.status };
    });
    if (!nextApplicationStatus(status, 'approve')) {
      throw new ConflictError(
        'APPLICATION_INVALID_STATE',
        `This application is ${status.replace('_', ' ')} and cannot be approved`,
      );
    }
    const statuses = await this.files.platformStatuses(
      documents.map((document) => document.fileId),
    );
    if (!statuses.some((file) => file.status === 'clean')) {
      throw new DomainError(
        'APPLICATION_DOCUMENTS_MISSING',
        'At least one proof-of-authority document must be scanned and clean before approval',
        422,
      );
    }

    for (let attempt = 0; ; attempt += 1) {
      const estateId = uuidv7();
      try {
        return await this.db.withContext(
          'tenancy',
          async (tx) => {
            const row = await this.load(tx, applicationId);
            const now = new Date();
            await this.transition(tx, row, 'approve', {
              reviewerId: staffId,
              decidedAt: now,
              estateId,
              decisionReason: null,
            });
            await tx.estate.create({
              data: {
                id: estateId,
                name: row.estateName,
                slug: generateEstateSlug(row.estateName),
                code: generateEstateCode(),
                type: row.estateType,
                address: row.address,
                state: row.state,
                lga: row.lga,
                status: 'approved',
                onboardingMode: 'self_service',
                approvedBy: staffId,
                approvedAt: now,
              },
            });
            await tx.estateMembership.create({
              data: { estateId, userId: row.applicantUserId, status: 'active' },
            });
            await this.authz.assignBuiltInRole(tx, {
              userId: row.applicantUserId,
              roleKey: 'estate_administrator',
              estateId,
              grantedBy: staffId,
              reason: `estate application ${applicationId} approved`,
            });
            await appendOutboxEvents(tx, [
              {
                type: 'tenancy.estate.created',
                estateId,
                aggregateType: 'estate',
                aggregateId: estateId,
                payload: { estateId, onboardingMode: 'self_service', applicationId },
              },
              {
                type: 'tenancy.application.approved',
                estateId,
                aggregateType: 'estate_application',
                aggregateId: applicationId,
                payload: { applicationId, estateId },
                audit: {
                  actorType: 'platform_staff',
                  actorId: staffId,
                  action: 'tenancy.application.approve',
                  resourceType: 'estate_application',
                  resourceId: applicationId,
                  after: { status: 'approved', estateId },
                },
              },
            ]);
            await this.notifications.request(tx, {
              intent: 'onboarding.application_approved',
              userIds: [row.applicantUserId],
              estateId,
              data: { estateName: row.estateName },
              dedupeKey: `application:${applicationId}:approved`,
            });
            return toApplicationView(await this.load(tx, applicationId));
          },
          { estateId, userId: staffId },
        );
      } catch (error) {
        // A random join code or slug collided: try again with new ones.
        if (isUniqueViolation(error) && attempt < 4) continue;
        throw error;
      }
    }
  }

  /** Signed download of an application document for the reviewer (audited by the files module). */
  async documentDownload(staffId: string, applicationId: string, fileId: string) {
    const linked = await this.db.withContext('tenancy', (tx) =>
      tx.estateApplicationDocument.findUnique({
        where: { applicationId_fileId: { applicationId, fileId } },
      }),
    );
    if (!linked) throw new NotFoundError('Document not found', 'FILE_NOT_FOUND');
    return this.files.platformDownloadUrl(
      staffId,
      fileId,
      `review of estate application ${applicationId}`,
    );
  }

  // ---- Internals -----------------------------------------------------------------------------

  private async decide(
    staffId: string,
    applicationId: string,
    action: Extract<ApplicationAction, 'start_review' | 'request_info' | 'reject'>,
    reason: string | null,
  ): Promise<ApplicationView> {
    return this.db.withContext(
      'tenancy',
      async (tx) => {
        const row = await this.load(tx, applicationId);
        const final = action === 'reject';
        await this.transition(tx, row, action, {
          reviewerId: staffId,
          ...(reason !== null ? { decisionReason: reason } : {}),
          ...(final ? { decidedAt: new Date() } : {}),
        });
        const type =
          action === 'start_review'
            ? 'tenancy.application.review_started'
            : action === 'request_info'
              ? 'tenancy.application.info_requested'
              : 'tenancy.application.rejected';
        await appendOutboxEvents(tx, [
          {
            type,
            estateId: null,
            aggregateType: 'estate_application',
            aggregateId: applicationId,
            payload: { applicationId },
            audit: {
              actorType: 'platform_staff',
              actorId: staffId,
              action: `tenancy.application.${action}`,
              resourceType: 'estate_application',
              resourceId: applicationId,
              before: { status: row.status },
              after: { status: nextApplicationStatus(row.status, action) ?? row.status },
              ...(reason ? { reason } : {}),
            },
          },
        ]);
        if (action !== 'start_review' && reason) {
          await this.notifications.request(tx, {
            intent:
              action === 'request_info'
                ? 'onboarding.application_info_requested'
                : 'onboarding.application_rejected',
            userIds: [row.applicantUserId],
            estateId: null,
            data: { estateName: row.estateName, reason },
            dedupeKey: `application:${applicationId}:${action}:${row.version}`,
          });
        }
        return toApplicationView(await this.load(tx, applicationId));
      },
      { userId: staffId },
    );
  }

  /**
   * Moves the application along its state machine. The status in the WHERE clause makes concurrent
   * decisions safe: the second reviewer gets APPLICATION_STATE_CHANGED.
   */
  private async transition(
    tx: Tx,
    row: ApplicationRow,
    action: ApplicationAction,
    data: Prisma.EstateApplicationUpdateManyMutationInput & { estateId?: string },
  ): Promise<void> {
    const next = nextApplicationStatus(row.status, action);
    if (!next) {
      throw new ConflictError(
        'APPLICATION_INVALID_STATE',
        `This application is ${row.status.replace('_', ' ')} and cannot be changed that way`,
      );
    }
    const updated = await tx.estateApplication.updateMany({
      where: { id: row.id, status: row.status, version: row.version },
      data: { ...data, status: next, version: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw new ConflictError(
        'APPLICATION_STATE_CHANGED',
        'Someone else changed this application. Reload and try again.',
      );
    }
  }

  private async load(tx: Tx, applicationId: string): Promise<ApplicationRow> {
    const row = await tx.estateApplication.findUnique({
      where: { id: applicationId },
      include: { documents: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) throw new NotFoundError('Application not found', 'APPLICATION_NOT_FOUND');
    return row;
  }

  /** Applicants only see their own applications; others look like they do not exist. */
  private async ownApplication(tx: Tx, userId: string, applicationId: string) {
    const row = await this.load(tx, applicationId);
    if (row.applicantUserId !== userId) {
      throw new NotFoundError('Application not found', 'APPLICATION_NOT_FOUND');
    }
    return row;
  }

  private async assertUsableDocuments(
    userId: string,
    fileIds: readonly string[],
    allowEmpty = false,
  ): Promise<void> {
    if (fileIds.length === 0 && allowEmpty) return;
    if (fileIds.length > MAX_DOCUMENTS) {
      throw new DomainError('TOO_MANY_DOCUMENTS', `Attach at most ${MAX_DOCUMENTS} documents`, 422);
    }
    const files = await this.files.ownFiles(userId, fileIds, 'estate_application');
    const byId = new Map(files.map((file) => [file.id, file]));
    const unusable = fileIds.filter((id) => {
      const file = byId.get(id);
      return !file || UNUSABLE_FILE_STATUSES.has(file.status);
    });
    if (unusable.length > 0) {
      throw new DomainError(
        'APPLICATION_DOCUMENT_INVALID',
        'One or more documents are missing, not uploaded yet, or were rejected. Upload them again.',
        422,
        unusable.map((id) => ({
          path: `documentFileIds.${fileIds.indexOf(id)}`,
          message: 'Document is not usable',
        })),
      );
    }
  }
}
