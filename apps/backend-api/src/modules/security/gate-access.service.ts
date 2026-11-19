import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { maskPhone } from '@safezone/auth';
import { BUILT_IN_ROLES, GATE_SESSION_PERMISSIONS } from '@safezone/permissions';
import type { gateSignInSchema, registerGateDeviceSchema } from '@safezone/schemas';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { AuthContext, EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import type { Tx } from '../../common/database/tenant-context';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { RateLimiter } from '../../common/rate-limit/rate-limiter';
import { AuthzService } from '../authz/authz.service';
import { SessionService } from '../identity/session.service';
import { TokenService } from '../identity/token.service';
import { UserDirectory } from '../identity/user-directory.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TenancyService } from '../tenancy/tenancy.service';
import {
  afterWrongPin,
  DEVICE_FAILURE_WINDOW_SECONDS,
  DEVICE_FAILURES_LIMIT,
  encodeDeviceCredential,
  guardDisplayName,
  parseDeviceCredential,
  pinWeakness,
} from './domain/gate-access';
import { GatesService } from './gates.service';
import { ShiftsService } from './shifts.service';

type DeviceRow = Prisma.GateDeviceGetPayload<object>;

/** Estate roles that may sign in at a gate (they hold gate.verify). */
const GUARD_ROLE_KEYS = BUILT_IN_ROLES.filter(
  (role) => role.level === 'estate' && role.permissions.includes('gate.verify'),
).map((role) => role.key);
/** Estate roles told when a guard's PIN locks. */
const SUPERVISOR_ROLE_KEYS = BUILT_IN_ROLES.filter(
  (role) => role.level === 'estate' && role.permissions.includes('security.staff.manage'),
).map((role) => role.key);

/** Argon2id, OWASP 2024 minimum (m=19 MiB, t=2, p=1). */
const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

const SIGNIN_FAILED = () =>
  new UnauthorizedError('Wrong guard or PIN. Try again.', 'GATE_SIGNIN_FAILED');

/**
 * Gate devices and guard PIN sign-in (ADR-0017). A supervisor registers a shared gate phone; guards set a
 * 6-digit PIN once from a full sign-in, then sign in on the device with it. The resulting session is
 * scoped to the device's estate and the gate permission ceiling by the authorization guard.
 */
@Injectable()
export class GateAccessService {
  constructor(
    private readonly db: DatabaseService,
    private readonly gates: GatesService,
    private readonly shifts: ShiftsService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly users: UserDirectory,
    private readonly authz: AuthzService,
    private readonly tenancy: TenancyService,
    private readonly notifications: NotificationsService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  private credentialHash(secret: string): string {
    return this.tokens.hashRefreshToken(`gate-device:v1:${secret}`);
  }

  // ---- Devices (supervisors) ------------------------------------------------------------------

  async register(
    access: EstateAccess,
    auth: AuthContext,
    input: z.infer<typeof registerGateDeviceSchema>,
  ) {
    if (auth.gateScope)
      throw new ForbiddenError('Register devices from your own sign-in', 'GATE_SESSION_SCOPE');
    const secret = randomBytes(32).toString('base64url');
    const result = await this.db.withTenant(access, async (tx) => {
      const gate = await this.gates.activeGate(tx, access.estateId, input.gateId);
      const row = await tx.gateDevice.create({
        data: {
          estateId: access.estateId,
          gateId: gate.id,
          name: input.name,
          credentialHash: this.credentialHash(secret),
          registeredBy: access.userId,
        },
      });
      await this.event(tx, access, 'security.device.registered', 'security.device.register', {
        deviceId: row.id,
        gateId: gate.id,
      });
      return { row, gateName: gate.name };
    });
    // The supervisor's own session on this shared phone ends now (ADR-0017 point 1).
    await this.sessions.revoke(auth.sessionId, auth.userId, 'signout');
    return {
      device: this.deviceView(result.row, new Map([[result.row.gateId, result.gateName]])),
      credential: encodeDeviceCredential(access.estateId, result.row.id, secret),
    };
  }

  async list(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.gateDevice.findMany({
        where: { estateId: access.estateId },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      });
      const gates = await tx.gate.findMany({
        where: { estateId: access.estateId, id: { in: [...new Set(rows.map((r) => r.gateId))] } },
        select: { id: true, name: true },
      });
      const names = new Map(gates.map((gate) => [gate.id, gate.name]));
      return rows.map((row) => this.deviceView(row, names));
    });
  }

  /** Deregistration: the credential stops working and every shift session on it ends at once. */
  async revoke(access: EstateAccess, deviceId: string) {
    const row = await this.db.withTenant(access, async (tx) => {
      const device = await tx.gateDevice.findFirst({
        where: { id: deviceId, estateId: access.estateId },
      });
      if (!device) throw new NotFoundError('Device not found', 'GATE_DEVICE_NOT_FOUND');
      if (device.status === 'revoked') return device;
      const updated = await tx.gateDevice.update({
        where: { id: device.id },
        data: { status: 'revoked', revokedAt: new Date(), revokedBy: access.userId },
      });
      await this.event(tx, access, 'security.device.revoked', 'security.device.revoke', {
        deviceId: device.id,
      });
      return updated;
    });
    await this.sessions.revokeGateSessions({ gateDeviceId: row.id }, 'device_revoked');
  }

  // ---- PINs ----------------------------------------------------------------------------------

  async pinStatus(access: EstateAccess) {
    const row = await this.db.withTenant(access, (tx) =>
      tx.guardPin.findUnique({
        where: { estateId_userId: { estateId: access.estateId, userId: access.userId } },
      }),
    );
    return { pinSet: Boolean(row), locked: Boolean(row?.lockedAt) };
  }

  /** A guard sets their own PIN, only from a full sign-in (phone, SMS code, MFA), never a gate session. */
  async setPin(access: EstateAccess, auth: AuthContext, pin: string) {
    if (auth.gateScope)
      throw new ForbiddenError('Set your PIN from your own sign-in', 'GATE_SESSION_SCOPE');
    const weakness = pinWeakness(pin);
    if (weakness)
      throw new DomainError(
        weakness === 'weak' ? 'PIN_TOO_EASY' : 'PIN_FORMAT',
        weakness === 'weak' ? 'Choose a PIN that is harder to guess' : 'Use 6 digits',
        422,
      );
    const pinHash = await argonHash(pin, ARGON);
    await this.db.withTenant(access, async (tx) => {
      await tx.guardPin.upsert({
        where: { estateId_userId: { estateId: access.estateId, userId: access.userId } },
        create: { estateId: access.estateId, userId: access.userId, pinHash },
        update: { pinHash, failedAttempts: 0, lockedAt: null, setAt: new Date() },
      });
      await this.event(tx, access, 'security.pin.set', 'security.pin.set', {
        userId: access.userId,
      });
    });
    // A new PIN ends gate sessions made with the old one.
    await this.sessions.revokeGateSessions(
      { userId: access.userId, estateId: access.estateId },
      'pin_reset',
    );
    return { pinSet: true, locked: false };
  }

  /** Supervisor reset (security-mobile.md §10): clears a locked or forgotten PIN and its sessions. */
  async resetPin(access: EstateAccess, userId: string) {
    await this.db.withTenant(access, async (tx) => {
      const deleted = await tx.guardPin.deleteMany({
        where: { estateId: access.estateId, userId },
      });
      if (deleted.count === 0) throw new NotFoundError('No PIN to reset', 'PIN_NOT_FOUND');
      await this.event(tx, access, 'security.pin.reset', 'security.pin.reset', { userId });
    });
    await this.sessions.revokeGateSessions({ userId, estateId: access.estateId }, 'pin_reset');
  }

  /** Supervisors: every guard with PIN status and any open shift. */
  async roster(access: EstateAccess) {
    const ids = await this.guardIds(access.estateId);
    const [contacts, assignments, rows] = await Promise.all([
      this.users.contactsOf(ids),
      Promise.all(ids.map((id) => this.authz.activeAssignments(id))),
      this.db.withTenant(access, async (tx) => {
        const [pins, shifts] = await Promise.all([
          tx.guardPin.findMany({ where: { estateId: access.estateId, userId: { in: ids } } }),
          tx.shiftSession.findMany({
            where: { estateId: access.estateId, userId: { in: ids }, endedAt: null },
          }),
        ]);
        const gates = await tx.gate.findMany({
          where: { estateId: access.estateId, id: { in: shifts.map((shift) => shift.gateId) } },
          select: { id: true, name: true },
        });
        return { pins, shifts, gates };
      }),
    ]);
    const pinOf = new Map(rows.pins.map((pin) => [pin.userId, pin]));
    const shiftOf = new Map(rows.shifts.map((shift) => [shift.userId, shift]));
    const gateName = new Map(rows.gates.map((gate) => [gate.id, gate.name]));
    const seesPhones = access.permissions.has('pii.view');
    return ids
      .map((userId, index) => {
        const contact = contacts.get(userId);
        const pin = pinOf.get(userId);
        const shift = shiftOf.get(userId);
        const roles = this.authz
          .grantIn(assignments[index] ?? [], access.estateId)
          .roles.filter((role) => GUARD_ROLE_KEYS.includes(role));
        return {
          userId,
          fullName: contact?.fullName ?? null,
          phone: contact ? (seesPhones ? contact.phone : maskPhone(contact.phone)) : '',
          roles,
          pinSet: Boolean(pin),
          locked: Boolean(pin?.lockedAt),
          pinSetAt: pin?.setAt.toISOString() ?? null,
          openShift: shift
            ? {
                id: shift.id,
                gateId: shift.gateId,
                gateName: gateName.get(shift.gateId) ?? null,
                startedAt: shift.startedAt.toISOString(),
              }
            : null,
        };
      })
      .sort((a, b) => (a.fullName ?? a.phone).localeCompare(b.fullName ?? b.phone));
  }

  // ---- Device-authenticated calls -------------------------------------------------------------

  /** The device behind a credential, or 401. Constant-time on the secret. */
  async verifyDevice(credential: string): Promise<DeviceRow> {
    const parsed = parseDeviceCredential(credential);
    if (!parsed) throw new UnauthorizedError('This phone is not registered', 'GATE_DEVICE_INVALID');
    const device = await this.db.withTenant({ estateId: parsed.estateId, userId: null }, (tx) =>
      tx.gateDevice.findFirst({
        where: { id: parsed.deviceId, estateId: parsed.estateId, status: 'active' },
      }),
    );
    const expected = Buffer.from(device?.credentialHash ?? '0'.repeat(64));
    const given = Buffer.from(this.credentialHash(parsed.secret));
    const matches =
      expected.length === given.length && timingSafeEqual(expected, given) && device !== null;
    if (!matches || !device)
      throw new UnauthorizedError('This phone is not registered', 'GATE_DEVICE_INVALID');
    const estate = await this.tenancy.getProfile({ estateId: device.estateId, userId: null });
    // Suspended estates keep their safety features (tenancy.md §7.5), gate checks included.
    if (estate.status !== 'active' && estate.status !== 'suspended')
      throw new UnauthorizedError('This phone is not registered', 'GATE_DEVICE_INVALID');
    return device;
  }

  /** The guards who can sign in on this device: first name and last initial only. */
  async guards(credential: string) {
    const device = await this.verifyDevice(credential);
    const context = { estateId: device.estateId, userId: null };
    const holders = await this.guardIds(device.estateId);
    const [contacts, pins, gate, estate] = await Promise.all([
      this.users.contactsOf(holders),
      this.db.withTenant(context, (tx) =>
        tx.guardPin.findMany({ where: { estateId: device.estateId, userId: { in: holders } } }),
      ),
      this.db.withTenant(context, (tx) =>
        tx.gate.findFirst({ where: { id: device.gateId, estateId: device.estateId } }),
      ),
      this.tenancy.getProfile(context),
    ]);
    const pinOf = new Map(pins.map((pin) => [pin.userId, pin]));
    await this.touch(device);
    return {
      estate: { id: device.estateId, name: estate.name },
      gate: { id: device.gateId, name: gate?.name ?? '' },
      device: { id: device.id, name: device.name },
      guards: holders
        .map((userId) => {
          const contact = contacts.get(userId);
          const pin = pinOf.get(userId);
          return {
            userId,
            displayName: guardDisplayName(
              contact?.fullName ?? null,
              contact ? maskPhone(contact.phone) : 'Guard',
            ),
            pinSet: Boolean(pin),
            locked: Boolean(pin?.lockedAt),
            pinSetAt: pin?.setAt.toISOString() ?? null,
          };
        })
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    };
  }

  async signIn(
    input: z.infer<typeof gateSignInSchema>,
    client: { ip?: string; userAgent?: string },
  ) {
    const device = await this.verifyDevice(input.deviceCredential);
    const limit = await this.rateLimiter.hit(
      `gate:signin:device:${device.id}`,
      DEVICE_FAILURES_LIMIT,
      DEVICE_FAILURE_WINDOW_SECONDS,
    );
    if (!limit.allowed)
      throw new DomainError(
        'RATE_LIMITED',
        'Too many sign-in attempts on this phone. Wait a few minutes.',
        429,
      );

    const estateId = device.estateId;
    const holders = await this.guardIds(estateId);
    if (!holders.includes(input.userId)) throw SIGNIN_FAILED();
    const context = { estateId, userId: input.userId };
    const pin = await this.db.withTenant(context, (tx) =>
      tx.guardPin.findUnique({ where: { estateId_userId: { estateId, userId: input.userId } } }),
    );
    if (!pin) throw new DomainError('PIN_NOT_SET', 'Set your PIN first', 422);
    if (pin.lockedAt)
      throw new DomainError(
        'PIN_LOCKED',
        'Your PIN is locked. Ask your supervisor to reset it.',
        423,
      );

    const ok = await argonVerify(pin.pinHash, input.pin);
    if (!ok) {
      const next = afterWrongPin(pin.failedAttempts);
      await this.db.withTenant(context, async (tx) => {
        await tx.guardPin.update({
          where: { id: pin.id },
          data: { failedAttempts: next.attempts, ...(next.locked ? { lockedAt: new Date() } : {}) },
        });
        if (next.locked) {
          await appendOutboxEvents(tx, [
            {
              type: 'security.pin.locked',
              estateId,
              aggregateType: 'guard_pin',
              aggregateId: pin.id,
              payload: { userId: input.userId, deviceId: device.id },
              audit: {
                actorType: 'system',
                action: 'security.pin.lock',
                resourceType: 'guard_pin',
                resourceId: pin.id,
                reason: 'too_many_wrong_pins',
              },
            },
          ]);
          const supervisors = await this.authz.holdersOf(estateId, SUPERVISOR_ROLE_KEYS);
          if (supervisors.length > 0)
            await this.notifications.request(tx, {
              intent: 'security.pin_locked',
              userIds: supervisors,
              estateId,
              data: { deviceName: device.name },
              dedupeKey: `guard-pin:${pin.id}:locked:${Date.now()}`,
            });
        }
      });
      if (next.locked)
        throw new DomainError(
          'PIN_LOCKED',
          'Your PIN is locked. Ask your supervisor to reset it.',
          423,
        );
      throw SIGNIN_FAILED();
    }

    if (pin.failedAttempts > 0)
      await this.db.withTenant(context, (tx) =>
        tx.guardPin.update({ where: { id: pin.id }, data: { failedAttempts: 0 } }),
      );
    const tokens = await this.sessions.createGateSession({
      userId: input.userId,
      estateId,
      gateDeviceId: device.id,
      appVersion: input.appVersion,
      platform: input.platform,
      client,
    });
    const access = await this.guardAccess(estateId, input.userId);
    let shiftId: string | null = null;
    try {
      shiftId = (await this.shifts.start(access, device.gateId)).id;
    } catch (error) {
      // A shift still open at another gate: sign in anyway; the app asks the guard to end it.
      if (!(error instanceof ConflictError)) throw error;
    }
    await this.touch(device);
    const contact = (await this.users.contactsOf([input.userId])).get(input.userId);
    return {
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
      refreshToken: tokens.refreshToken,
      mfaRequired: false as const,
      mfaEnrolled: true,
      isNewUser: false as const,
      user: {
        id: input.userId,
        phone: contact ? maskPhone(contact.phone) : '',
        fullName: contact?.fullName ?? null,
        mfaEnabled: true,
      },
      sessionExpiresAt: tokens.expiresAt.toISOString(),
      estateId,
      gateId: device.gateId,
      deviceId: device.id,
      shiftId,
      pinSetAt: pin.setAt.toISOString(),
    };
  }

  /** The estate access of a guard, as the authorization guard would build it (gate ceiling applied). */
  async guardAccess(estateId: string, userId: string): Promise<EstateAccess> {
    const assignments = await this.authz.activeAssignments(userId);
    const grant = this.authz.grantIn(assignments, estateId);
    const permissions = new Set<string>(
      GATE_SESSION_PERMISSIONS.filter((permission) => grant.permissions.has(permission)),
    );
    return { estateId, userId, roles: grant.roles, permissions };
  }

  /** Guard user ids of an estate (for device-authenticated sync). */
  async guardsOf(estateId: string): Promise<Set<string>> {
    return new Set(await this.guardIds(estateId));
  }

  /** Active members of the estate who hold a guard role there now. */
  private async guardIds(estateId: string): Promise<string[]> {
    const [holders, members] = await Promise.all([
      this.authz.holdersOf(estateId, GUARD_ROLE_KEYS),
      this.tenancy.activeMemberIds(estateId),
    ]);
    const active = new Set(members);
    return [...new Set(holders)].filter((id) => active.has(id));
  }

  private async touch(device: DeviceRow) {
    if (device.lastSeenAt && Date.now() - device.lastSeenAt.getTime() < 5 * 60_000) return;
    await this.db.withTenant({ estateId: device.estateId, userId: null }, (tx) =>
      tx.gateDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } }),
    );
  }

  private deviceView(row: DeviceRow, gateNames: Map<string, string>) {
    return {
      id: row.id,
      gateId: row.gateId,
      gateName: gateNames.get(row.gateId) ?? null,
      name: row.name,
      status: row.status as 'active',
      registeredBy: row.registeredBy,
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
    };
  }

  private async event(
    tx: Tx,
    access: EstateAccess,
    type: string,
    action: string,
    details: Record<string, string>,
  ) {
    const resourceId = details.deviceId ?? details.userId ?? access.userId;
    await appendOutboxEvents(tx, [
      {
        type,
        estateId: access.estateId,
        aggregateType: details.deviceId ? 'gate_device' : 'guard_pin',
        aggregateId: resourceId,
        payload: details,
        audit: {
          actorType: 'user',
          actorId: access.userId,
          action,
          resourceType: details.deviceId ? 'gate_device' : 'guard_pin',
          resourceId,
          after: details,
        },
      },
    ]);
  }
}
