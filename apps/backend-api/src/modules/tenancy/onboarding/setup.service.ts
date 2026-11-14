import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import type { TenantContext } from '../../../common/database/tenant-context';
import { ConflictError, DomainError, NotFoundError } from '../../../common/errors/domain-error';
import { appendOutboxEvents } from '../../../common/outbox/outbox-writer';
import { AuthzService } from '../../authz/authz.service';
import { nextEstateStatus } from '../domain/estate-lifecycle';
import {
  missingSetupSteps,
  REQUIRED_SETUP_STEPS,
  SETUP_STEPS,
  type SetupStep,
} from '../domain/setup';

/** Returns null when the step's facts are in place, otherwise a message for the administrator. */
export type SetupVerifier = (estateId: string) => Promise<string | null>;

/**
 * Modules that own a setup fact register a verifier for its step (e.g. property for `spaces`: at least
 * one unit). Steps without a verifier are confirmed by the administrator.
 */
@Injectable()
export class SetupVerifiers {
  private readonly verifiers = new Map<SetupStep, SetupVerifier>();

  register(step: SetupStep, verifier: SetupVerifier): void {
    this.verifiers.set(step, verifier);
  }

  get(step: SetupStep): SetupVerifier | undefined {
    return this.verifiers.get(step);
  }
}

/** Setup wizard progress and activation (tenancy.md §4.1 step 6, §7.4). */
@Injectable()
export class SetupService {
  constructor(
    private readonly db: DatabaseService,
    private readonly authz: AuthzService,
    private readonly verifiers: SetupVerifiers,
  ) {
    this.verifiers.register('security_supervisor', async (estateId) =>
      (await this.authz.countHolders(estateId, 'security_supervisor')) > 0
        ? null
        : 'Add at least one security supervisor first',
    );
  }

  async progress(context: TenantContext) {
    return this.db.withTenant(context, async (tx) => {
      const estate = await tx.estate.findUnique({
        where: { id: context.estateId },
        select: { status: true },
      });
      if (!estate) throw new NotFoundError('Estate not found', 'ESTATE_NOT_FOUND');
      const rows = await tx.estateSetupStep.findMany({ where: { estateId: context.estateId } });
      const done = new Map(rows.map((row) => [row.step, row.completedAt]));
      const missing = missingSetupSteps(new Set(done.keys()));
      return {
        estateStatus: estate.status,
        steps: SETUP_STEPS.map((step) => ({
          step,
          required: REQUIRED_SETUP_STEPS.includes(step),
          completedAt: done.get(step)?.toISOString() ?? null,
        })),
        missing,
        canActivate: estate.status === 'approved' && missing.length === 0,
      };
    });
  }

  async completeStep(context: TenantContext, step: SetupStep) {
    const verifier = this.verifiers.get(step);
    const problem = verifier ? await verifier(context.estateId) : null;
    if (problem) throw new DomainError('SETUP_STEP_INCOMPLETE', problem, 422);
    await this.db.withTenant(context, async (tx) => {
      await tx.estateSetupStep.upsert({
        where: { estateId_step: { estateId: context.estateId, step } },
        create: { estateId: context.estateId, step, completedBy: context.userId },
        update: {},
      });
      await appendOutboxEvents(tx, [
        {
          type: 'tenancy.setup_step.completed',
          estateId: context.estateId,
          aggregateType: 'estate',
          aggregateId: context.estateId,
          payload: { step },
        },
      ]);
    });
    return this.progress(context);
  }

  /** Approved → active once every required step is done (re-verified now, facts may have changed). */
  async activate(context: TenantContext) {
    const current = await this.progress(context);
    if (current.missing.length > 0) {
      throw new DomainError(
        'SETUP_INCOMPLETE',
        `Finish these steps first: ${current.missing.join(', ')}`,
        422,
      );
    }
    for (const step of REQUIRED_SETUP_STEPS) {
      const verifier = this.verifiers.get(step);
      const problem = verifier ? await verifier(context.estateId) : null;
      if (problem) throw new DomainError('SETUP_STEP_INCOMPLETE', problem, 422);
    }
    await this.db.withTenant(context, async (tx) => {
      const estate = await tx.estate.findUniqueOrThrow({ where: { id: context.estateId } });
      const next = nextEstateStatus(estate.status, 'activate', estate.activatedAt !== null);
      if (!next) {
        throw new ConflictError(
          'ESTATE_INVALID_STATE',
          `This estate is ${estate.status} and cannot be activated`,
        );
      }
      const updated = await tx.estate.updateMany({
        where: { id: context.estateId, status: estate.status, version: estate.version },
        data: { status: next, activatedAt: new Date(), version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConflictError(
          'VERSION_MISMATCH',
          'This estate was changed by someone else. Reload and try again.',
        );
      }
      await appendOutboxEvents(tx, [
        {
          type: 'tenancy.estate.activated',
          estateId: context.estateId,
          aggregateType: 'estate',
          aggregateId: context.estateId,
          payload: { estateId: context.estateId },
          audit: {
            actorType: 'user',
            actorId: context.userId,
            action: 'tenancy.estate.activate',
            resourceType: 'estate',
            resourceId: context.estateId,
            before: { status: estate.status },
            after: { status: next },
          },
        },
      ]);
    });
    return this.progress(context);
  }
}
