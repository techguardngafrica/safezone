import { Injectable } from '@nestjs/common';
import type {
  addCompanyGuardSchema,
  createPatrolRouteSchema,
  createSecurityCompanySchema,
  createSecurityContractSchema,
  scanCheckpointSchema,
  startPatrolRunSchema,
  syncPatrolScansSchema,
  updateSecurityCompanySchema,
} from '@safezone/schemas';
import { z } from 'zod';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import { ConflictError, DomainError, NotFoundError } from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { dateOnly, parseDateOnly } from '../billing/domain/billing';

/**
 * Security Operations Depth (security.md Phase 5, ADR-0026):
 * cross-estate Security Companies (platform-level) + QR/NFC patrol routes, runs and offline scan sync.
 */
@Injectable()
export class SecurityDepthService {
  constructor(private readonly db: DatabaseService) {}

  // ---- Platform Security Companies --------------------------------------------------------------

  async listCompanies() {
    return this.db.withContext('security_companies', async (tx) => {
      const rows = await tx.securityCompany.findMany({
        include: {
          _count: { select: { guards: true } },
          contracts: { where: { status: 'active' }, select: { id: true } },
        },
        orderBy: { name: 'asc' },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        registrationNumber: r.registrationNumber,
        contactName: r.contactName,
        contactPhone: r.contactPhone,
        contactEmail: r.contactEmail,
        status: r.status as 'active' | 'suspended',
        guardCount: r._count.guards,
        activeContractCount: r.contracts.length,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  async createCompany(actorId: string, input: z.infer<typeof createSecurityCompanySchema>) {
    return this.db.withContext('security_companies', async (tx) => {
      const r = await tx.securityCompany.create({
        data: {
          name: input.name,
          registrationNumber: input.registrationNumber ?? null,
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          contactEmail: input.contactEmail ?? null,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'security.company.created',
          estateId: null,
          aggregateType: 'security_company',
          aggregateId: r.id,
          payload: { companyId: r.id, name: r.name },
          audit: {
            actorType: 'platform_staff',
            actorId,
            action: 'security.company.create',
            resourceType: 'security_company',
            resourceId: r.id,
          },
        },
      ]);
      return {
        id: r.id,
        name: r.name,
        registrationNumber: r.registrationNumber,
        contactName: r.contactName,
        contactPhone: r.contactPhone,
        contactEmail: r.contactEmail,
        status: r.status as 'active' | 'suspended',
        guardCount: 0,
        activeContractCount: 0,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  async updateCompany(id: string, input: z.infer<typeof updateSecurityCompanySchema>) {
    return this.db.withContext('security_companies', async (tx) => {
      const existing = await tx.securityCompany.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError('Security company not found', 'COMPANY_NOT_FOUND');
      const r = await tx.securityCompany.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.registrationNumber !== undefined
            ? { registrationNumber: input.registrationNumber }
            : {}),
          ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
          ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
          ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
        include: {
          _count: { select: { guards: true } },
          contracts: { where: { status: 'active' }, select: { id: true } },
        },
      });
      return {
        id: r.id,
        name: r.name,
        registrationNumber: r.registrationNumber,
        contactName: r.contactName,
        contactPhone: r.contactPhone,
        contactEmail: r.contactEmail,
        status: r.status as 'active' | 'suspended',
        guardCount: r._count.guards,
        activeContractCount: r.contracts.length,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  async addCompanyGuard(companyId: string, input: z.infer<typeof addCompanyGuardSchema>) {
    return this.db.withContext('security_companies', async (tx) => {
      const company = await tx.securityCompany.findUnique({ where: { id: companyId } });
      if (!company) throw new NotFoundError('Security company not found', 'COMPANY_NOT_FOUND');
      const r = await tx.securityCompanyGuard.upsert({
        where: { companyId_userId: { companyId, userId: input.userId } },
        create: {
          companyId,
          userId: input.userId,
          badgeNumber: input.badgeNumber,
          status: 'active',
        },
        update: { badgeNumber: input.badgeNumber, status: 'active' },
      });
      return {
        id: r.id,
        companyId: r.companyId,
        userId: r.userId,
        badgeNumber: r.badgeNumber,
        status: r.status as 'active' | 'inactive',
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  async listCompanyGuards(companyId: string) {
    return this.db.withContext('security_companies', async (tx) => {
      const rows = await tx.securityCompanyGuard.findMany({
        where: { companyId },
        orderBy: { badgeNumber: 'asc' },
      });
      return rows.map((r) => ({
        id: r.id,
        companyId: r.companyId,
        userId: r.userId,
        badgeNumber: r.badgeNumber,
        status: r.status as 'active' | 'inactive',
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  async createContract(input: z.infer<typeof createSecurityContractSchema>) {
    return this.db.withContext('security_companies', async (tx) => {
      const company = await tx.securityCompany.findUnique({ where: { id: input.companyId } });
      if (!company) throw new NotFoundError('Security company not found', 'COMPANY_NOT_FOUND');
      const r = await tx.estateSecurityContract.create({
        data: {
          companyId: input.companyId,
          estateId: input.estateId,
          startsOn: parseDateOnly(input.startsOn),
          endsOn: input.endsOn ? parseDateOnly(input.endsOn) : null,
          status: 'pending',
        },
        include: { company: { select: { name: true } } },
      });
      return this.contractView(r);
    });
  }

  async listEstateContracts(estateId: string) {
    return this.db.withContext('security_companies', async (tx) => {
      const rows = await tx.estateSecurityContract.findMany({
        where: { estateId },
        include: { company: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((r) => this.contractView(r));
    });
  }

  async updateEstateContractStatus(
    access: EstateAccess,
    contractId: string,
    status: 'active' | 'terminated',
  ) {
    return this.db.withContext('security_companies', async (tx) => {
      const existing = await tx.estateSecurityContract.findFirst({
        where: { id: contractId, estateId: access.estateId },
      });
      if (!existing) throw new NotFoundError('Security contract not found', 'CONTRACT_NOT_FOUND');
      const r = await tx.estateSecurityContract.update({
        where: { id: contractId },
        data: {
          status,
          ...(status === 'active' ? { approvedBy: access.userId } : {}),
        },
        include: { company: { select: { name: true } } },
      });
      return this.contractView(r);
    });
  }

  // ---- Patrol Routes, Runs & Offline Checkpoint Sync --------------------------------------------

  async listPatrolRoutes(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.patrolRoute.findMany({
        where: { estateId: access.estateId },
        include: { checkpoints: { orderBy: { sequence: 'asc' } } },
        orderBy: { name: 'asc' },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        intervalMinutes: r.intervalMinutes,
        active: r.active,
        checkpoints: r.checkpoints.map((c) => ({
          id: c.id,
          routeId: c.routeId,
          sequence: c.sequence,
          name: c.name,
          spaceId: c.spaceId,
          tagType: c.tagType as 'qr' | 'nfc',
          tagCode: c.tagCode,
          active: c.active,
        })),
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  async createPatrolRoute(access: EstateAccess, input: z.infer<typeof createPatrolRouteSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const r = await tx.patrolRoute.create({
        data: {
          estateId: access.estateId,
          name: input.name,
          description: input.description ?? null,
          intervalMinutes: input.intervalMinutes,
          checkpoints: {
            create: input.checkpoints.map((c) => ({
              estateId: access.estateId,
              sequence: c.sequence,
              name: c.name,
              spaceId: c.spaceId ?? null,
              tagType: c.tagType,
              tagCode: c.tagCode,
            })),
          },
        },
        include: { checkpoints: { orderBy: { sequence: 'asc' } } },
      });
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        intervalMinutes: r.intervalMinutes,
        active: r.active,
        checkpoints: r.checkpoints.map((c) => ({
          id: c.id,
          routeId: c.routeId,
          sequence: c.sequence,
          name: c.name,
          spaceId: c.spaceId,
          tagType: c.tagType as 'qr' | 'nfc',
          tagCode: c.tagCode,
          active: c.active,
        })),
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  async listPatrolRuns(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.patrolRun.findMany({
        where: { estateId: access.estateId },
        include: {
          route: { include: { _count: { select: { checkpoints: true } } } },
          logs: {
            include: { checkpoint: { select: { name: true } } },
            orderBy: { scannedAt: 'asc' },
          },
        },
        orderBy: { startedAt: 'desc' },
        take: 100,
      });
      return rows.map((r) => this.runView(r));
    });
  }

  async startPatrolRun(access: EstateAccess, input: z.infer<typeof startPatrolRunSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const route = await tx.patrolRoute.findFirst({
        where: { estateId: access.estateId, id: input.routeId, active: true },
        include: { _count: { select: { checkpoints: true } } },
      });
      if (!route) throw new NotFoundError('Patrol route not found', 'PATROL_ROUTE_NOT_FOUND');
      const r = await tx.patrolRun.create({
        data: {
          estateId: access.estateId,
          routeId: route.id,
          guardUserId: access.userId,
          deviceId: input.deviceId ?? null,
          status: 'in_progress',
        },
        include: {
          route: { include: { _count: { select: { checkpoints: true } } } },
          logs: { include: { checkpoint: { select: { name: true } } } },
        },
      });
      return this.runView(r);
    });
  }

  async scanCheckpoint(
    access: EstateAccess,
    runId: string,
    input: z.infer<typeof scanCheckpointSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const run = await tx.patrolRun.findFirst({
        where: { estateId: access.estateId, id: runId },
        include: { route: { include: { checkpoints: true } } },
      });
      if (!run) throw new NotFoundError('Patrol run not found', 'PATROL_RUN_NOT_FOUND');
      if (run.status === 'completed') {
        throw new ConflictError('PATROL_ALREADY_COMPLETED', 'This patrol run is already completed');
      }
      const checkpoint = run.route.checkpoints.find(
        (c) =>
          (input.checkpointId && c.id === input.checkpointId) ||
          (input.tagCode && c.tagCode === input.tagCode),
      );
      if (!checkpoint) {
        throw new DomainError(
          'INVALID_CHECKPOINT',
          'Checkpoint tag does not belong to this route',
          422,
        );
      }

      const existing = await tx.patrolLog.findUnique({
        where: { runId_checkpointId: { runId: run.id, checkpointId: checkpoint.id } },
      });
      const log =
        existing ??
        (await tx.patrolLog.create({
          data: {
            estateId: access.estateId,
            runId: run.id,
            checkpointId: checkpoint.id,
            guardUserId: access.userId,
            scannedAt: input.scannedAt ? new Date(input.scannedAt) : new Date(),
            offlineRecorded: input.offlineRecorded,
            notes: input.notes ?? null,
            photoFileId: input.photoFileId ?? null,
          },
        }));

      const totalScanned = await tx.patrolLog.count({ where: { runId: run.id } });
      if (totalScanned >= run.route.checkpoints.length) {
        await tx.patrolRun.update({
          where: { id: run.id },
          data: { status: 'completed', completedAt: new Date() },
        });
      }

      await appendOutboxEvents(tx, [
        {
          type: 'security.patrol.scanned',
          estateId: access.estateId,
          aggregateType: 'patrol_run',
          aggregateId: run.id,
          payload: { runId: run.id, checkpointId: checkpoint.id, totalScanned },
        },
      ]);

      return {
        id: log.id,
        runId: log.runId,
        checkpointId: log.checkpointId,
        checkpointName: checkpoint.name,
        guardUserId: log.guardUserId,
        scannedAt: log.scannedAt.toISOString(),
        offlineRecorded: log.offlineRecorded,
        notes: log.notes,
        photoFileId: log.photoFileId,
      };
    });
  }

  async syncPatrolScans(access: EstateAccess, input: z.infer<typeof syncPatrolScansSchema>) {
    let accepted = 0;
    for (const scan of input.scans) {
      try {
        await this.scanCheckpoint(access, scan.runId, {
          checkpointId: scan.checkpointId,
          tagCode: scan.tagCode,
          scannedAt: scan.scannedAt,
          offlineRecorded: true,
          notes: scan.notes,
        });
        accepted += 1;
      } catch {
        /* skip duplicate or invalid offline scan without aborting the batch */
      }
    }
    return { accepted, total: input.scans.length };
  }

  private contractView(r: {
    id: string;
    companyId: string;
    company: { name: string };
    estateId: string;
    startsOn: Date;
    endsOn: Date | null;
    status: string;
    approvedBy: string | null;
    createdAt: Date;
  }) {
    return {
      id: r.id,
      companyId: r.companyId,
      companyName: r.company.name,
      estateId: r.estateId,
      startsOn: dateOnly(r.startsOn),
      endsOn: r.endsOn ? dateOnly(r.endsOn) : null,
      status: r.status as 'pending' | 'active' | 'terminated',
      approvedBy: r.approvedBy,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private runView(r: {
    id: string;
    routeId: string;
    route: { name: string; _count: { checkpoints: number } };
    guardUserId: string;
    deviceId: string | null;
    startedAt: Date;
    completedAt: Date | null;
    status: string;
    logs: {
      id: string;
      runId: string;
      checkpointId: string;
      checkpoint: { name: string };
      guardUserId: string;
      scannedAt: Date;
      offlineRecorded: boolean;
      notes: string | null;
      photoFileId: string | null;
    }[];
  }) {
    return {
      id: r.id,
      routeId: r.routeId,
      routeName: r.route.name,
      guardUserId: r.guardUserId,
      deviceId: r.deviceId,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      status: r.status as 'in_progress' | 'completed' | 'incomplete',
      scannedCount: r.logs.length,
      totalCheckpoints: r.route._count.checkpoints,
      logs: r.logs.map((l) => ({
        id: l.id,
        runId: l.runId,
        checkpointId: l.checkpointId,
        checkpointName: l.checkpoint.name,
        guardUserId: l.guardUserId,
        scannedAt: l.scannedAt.toISOString(),
        offlineRecorded: l.offlineRecorded,
        notes: l.notes,
        photoFileId: l.photoFileId,
      })),
    };
  }
}
