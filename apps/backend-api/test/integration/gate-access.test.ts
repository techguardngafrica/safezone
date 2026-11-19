import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/common/ids/uuidv7';
import { countRows, signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

describe('gate devices and guard PIN sign-in (ADR-0017)', () => {
  let stack: TestStack;
  let estateId: string;
  let otherEstateId: string;
  let gateId: string;
  let backGateId: string;
  let supervisor: { token: string; userId: string };
  let guard: { token: string; userId: string };
  let resident: { token: string; userId: string };
  let credential: string;
  let deviceId: string;
  let gateToken: string;
  let gateRefresh: string;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const url = (path: string, estate = estateId) => `/v1/estates/${estate}${path}`;

  async function staff(phone: string, role: string, name: string, estate = estateId) {
    const userId = await stack.createUser(phone, name);
    await stack.addMember(estate, userId, role);
    await stack.resetRateLimits();
    const token = (await signIn(stack, phone, WEB_DEVICE)).accessToken;
    await stack.db.owner.query(
      `update platform.sessions set mfa_verified_at = now() where user_id = $1`,
      [userId],
    );
    return { token, userId };
  }

  const signInAt = (pin: string, userId = guard.userId, device = credential) =>
    stack.http
      .post('/v1/auth/gate/signin')
      .send({ deviceCredential: device, userId, pin, platform: 'android', appVersion: '1.0.0' });

  beforeAll(async () => {
    stack = await startTestStack();
    estateId = await stack.createEstate('Gate Estate');
    otherEstateId = await stack.createEstate('Other Estate');
    supervisor = await staff('+2348040000001', 'security_supervisor', 'Bola Ade Okafor');
    guard = await staff('+2348040000002', 'security_officer', 'Musa Bello');
    await stack.addMember(otherEstateId, guard.userId, 'security_officer');
    const residentId = await stack.createUser('+2348040000010');
    await stack.addMember(estateId, residentId, 'tenant');
    resident = { token: (await signIn(stack, '+2348040000010')).accessToken, userId: residentId };
    const gate = async (name: string) =>
      (
        await stack.http
          .post(url('/gates'))
          .set(as(supervisor.token))
          .send({ name, type: 'both' })
          .expect(201)
      ).body.data.id as string;
    gateId = await gate('Main gate');
    backGateId = await gate('Back gate');
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('registers a gate phone and signs the supervisor out of it', async () => {
    await stack.http
      .post(url('/gate-devices'))
      .set(as(guard.token))
      .send({ gateId, name: 'Main gate phone' })
      .expect(403);
    const registered = await stack.http
      .post(url('/gate-devices'))
      .set(as(supervisor.token))
      .send({ gateId, name: 'Main gate phone' })
      .expect(201);
    credential = registered.body.data.credential;
    deviceId = registered.body.data.device.id;
    expect(credential).toMatch(/^gd1\./);
    expect(registered.body.data.device).toMatchObject({ gateName: 'Main gate', status: 'active' });
    await stack.http.get('/v1/me').set(as(supervisor.token)).expect(401);
    const stored = await stack.db.owner.query<{ credential_hash: string }>(
      `select credential_hash from tenant.gate_devices where id = $1`,
      [deviceId],
    );
    expect(stored.rows[0]?.credential_hash).not.toContain(credential.split('.')[3]);
    // Sign the supervisor in again on their own phone.
    await stack.resetRateLimits();
    supervisor = {
      token: (await signIn(stack, '+2348040000001', WEB_DEVICE)).accessToken,
      userId: supervisor.userId,
    };
    await stack.db.owner.query(
      `update platform.sessions set mfa_verified_at = now() where user_id = $1`,
      [supervisor.userId],
    );
  });

  it('lists guards for the device with first name and last initial only', async () => {
    await stack.http
      .post('/v1/auth/gate/guards')
      .send({ deviceCredential: `${credential.slice(0, -3)}AAA` })
      .expect(401);
    const list = await stack.http
      .post('/v1/auth/gate/guards')
      .send({ deviceCredential: credential })
      .expect(200);
    expect(list.body.data.gate).toEqual({ id: gateId, name: 'Main gate' });
    const names = list.body.data.guards.map((g: { displayName: string }) => g.displayName);
    expect(names).toEqual(['Bola O.', 'Musa B.']);
    expect(JSON.stringify(list.body.data)).not.toContain('+234');
    expect(list.body.data.guards.every((g: { pinSet: boolean }) => !g.pinSet)).toBe(true);
  });

  it('lets a guard set a PIN from a full sign-in, refusing easy ones', async () => {
    await signInAt('482913').expect(422);
    const weak = await stack.http
      .put(url('/me/guard-pin'))
      .set(as(guard.token))
      .send({ pin: '123456' })
      .expect(422);
    expect(weak.body.error.code).toBe('PIN_TOO_EASY');
    await stack.http
      .put(url('/me/guard-pin'))
      .set(as(resident.token))
      .send({ pin: '482913' })
      .expect(403);
    await stack.http
      .put(url('/me/guard-pin'))
      .set(as(guard.token))
      .send({ pin: '482913' })
      .expect(200);
    const stored = await stack.db.owner.query<{ pin_hash: string }>(
      `select pin_hash from tenant.guard_pins where user_id = $1`,
      [guard.userId],
    );
    expect(stored.rows[0]?.pin_hash).toMatch(/^\$argon2id\$/);
  });

  it('signs a guard in with the PIN, starts the shift, and refuses non-guards the same way', async () => {
    const wrongGuard = await signInAt('482913', resident.userId).expect(401);
    const wrongPin = await signInAt('482914').expect(401);
    expect(wrongGuard.body.error.code).toBe('GATE_SIGNIN_FAILED');
    expect(wrongGuard.body.error.message).toBe(wrongPin.body.error.message);
    const ok = await signInAt('482913').expect(200);
    gateToken = ok.body.data.accessToken;
    gateRefresh = ok.body.data.refreshToken;
    expect(ok.body.data).toMatchObject({ estateId, gateId, deviceId, mfaRequired: false });
    expect(ok.body.data.shiftId).toBeTruthy();
    expect(ok.body.data.user.phone).toContain('****');
    const hours = (new Date(ok.body.data.sessionExpiresAt).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(11.9);
    expect(hours).toBeLessThanOrEqual(12);
  });

  it('keeps a gate session inside its estate and the gate permission ceiling', async () => {
    await stack.http.get('/v1/me').set(as(gateToken)).expect(200);
    const sessions = await stack.http.get('/v1/me/sessions').set(as(gateToken)).expect(403);
    expect(sessions.body.error.code).toBe('GATE_SESSION_SCOPE');
    await stack.http.get(url('/gate/expected')).query({ gateId }).set(as(gateToken)).expect(200);
    await stack.http.get(url('/gates', otherEstateId)).set(as(gateToken)).expect(404);
    await stack.http
      .put(url('/me/guard-pin'))
      .set(as(gateToken))
      .send({ pin: '905127' })
      .expect(403);
    const permissions = await stack.http
      .get('/v1/me/permissions')
      .query({ estateId })
      .set(as(gateToken))
      .expect(200);
    expect(permissions.body.data.permissions).toEqual([
      'gate.verify',
      'incident.report',
      'sos.respond',
      'sos.trigger',
    ]);
    const memberships = await stack.http.get('/v1/me/memberships').set(as(gateToken)).expect(200);
    expect(memberships.body.data.map((m: { estate: { id: string } }) => m.estate.id)).toEqual([
      estateId,
    ]);
  });

  it('limits a supervisor signed in at the gate to gate work', async () => {
    await stack.http
      .put(url('/me/guard-pin'))
      .set(as(supervisor.token))
      .send({ pin: '370418' })
      .expect(200);
    const signed = await signInAt('370418', supervisor.userId).expect(200);
    await stack.http.get(url('/shift-sessions')).set(as(signed.body.data.accessToken)).expect(403);
    await stack.http.get(url('/gate-devices')).set(as(signed.body.data.accessToken)).expect(403);
  });

  it('never extends a gate session on refresh', async () => {
    const before = await stack.db.owner.query<{ expires_at: Date }>(
      `select expires_at from platform.sessions where kind = 'gate_shift' and user_id = $1 and revoked_at is null`,
      [guard.userId],
    );
    const refreshed = await stack.http
      .post('/v1/auth/refresh')
      .set('X-Safezone-App', 'security-mobile')
      .send({ refreshToken: gateRefresh })
      .expect(200);
    gateToken = refreshed.body.data.accessToken;
    const after = await stack.db.owner.query<{ expires_at: Date }>(
      `select expires_at from platform.sessions where kind = 'gate_shift' and user_id = $1 and revoked_at is null`,
      [guard.userId],
    );
    expect(after.rows[0]?.expires_at.getTime()).toBe(before.rows[0]?.expires_at.getTime());
  });

  it('accepts offline-signed events for its own gate and guards only', async () => {
    const event = (overrides: Record<string, unknown>) => ({
      clientUuid: uuidv7(),
      gateId,
      direction: 'in',
      visitorName: 'Walk-in courier',
      decision: 'check',
      reason: 'Offline: host confirmed by phone',
      occurredAt: new Date(Date.now() - 60_000).toISOString(),
      guardUserId: guard.userId,
      ...overrides,
    });
    const good = event({});
    const result = await stack.http
      .post('/v1/gate-devices/sync')
      .send({
        deviceCredential: credential,
        deviceNow: new Date().toISOString(),
        events: [good, event({ gateId: backGateId }), event({ guardUserId: resident.userId })],
      })
      .expect(200);
    expect(result.body.data.accepted).toBe(1);
    expect(result.body.data.rejected.map((r: { code: string }) => r.code).sort()).toEqual([
      'GUARD_INVALID',
      'WRONG_GATE',
    ]);
    const row = await stack.db.owner.query<{
      offline_signin: boolean;
      guard_user_id: string;
      device_id: string;
    }>(
      `select offline_signin, guard_user_id, device_id from tenant.gate_events where client_uuid = $1`,
      [good.clientUuid],
    );
    expect(row.rows[0]).toEqual({
      offline_signin: true,
      guard_user_id: guard.userId,
      device_id: deviceId,
    });
  });

  it('locks a PIN after 5 wrong tries, tells supervisors, and a reset clears it', async () => {
    await stack.resetRateLimits();
    for (let attempt = 1; attempt <= 4; attempt += 1) await signInAt('111222').expect(401);
    const locked = await signInAt('111222').expect(423);
    expect(locked.body.error.code).toBe('PIN_LOCKED');
    await signInAt('482913').expect(423);
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.outbox_events where type = 'notifications.request.created'
           and payload->>'intent' = 'security.pin_locked'`,
      ),
    ).toBe(1);
    await stack.http
      .post(url(`/guards/${guard.userId}/pin-reset`))
      .set(as(guard.token))
      .expect(403);
    await stack.http
      .post(url(`/guards/${guard.userId}/pin-reset`))
      .set(as(supervisor.token))
      .expect(204);
    // The reset ended the guard's gate session too.
    await stack.http.get('/v1/me').set(as(gateToken)).expect(401);
    await signInAt('482913').expect(422);
  });

  it('blocks a device after too many sign-in attempts', async () => {
    await stack.resetRateLimits();
    for (let attempt = 0; attempt < 20; attempt += 1) await signInAt('905127');
    const blocked = await signInAt('905127').expect(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    await stack.resetRateLimits();
  });

  it('deregistering a device ends its sessions and its credential', async () => {
    await stack.http
      .put(url('/me/guard-pin'))
      .set(as(guard.token))
      .send({ pin: '482913' })
      .expect(200);
    const signed = await signInAt('482913').expect(200);
    await stack.http
      .delete(url(`/gate-devices/${deviceId}`))
      .set(as(supervisor.token))
      .expect(204);
    await stack.http.get('/v1/me').set(as(signed.body.data.accessToken)).expect(401);
    await stack.http
      .post('/v1/auth/gate/guards')
      .send({ deviceCredential: credential })
      .expect(401);
    const devices = await stack.http
      .get(url('/gate-devices'))
      .set(as(supervisor.token))
      .expect(200);
    expect(devices.body.data[0]).toMatchObject({ id: deviceId, status: 'revoked' });
  });
});
