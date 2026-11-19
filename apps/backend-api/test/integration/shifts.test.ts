import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countRows, signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

describe('security shifts and handover', () => {
  let stack: TestStack;
  let estateId: string;
  let guardA: { token: string; userId: string };
  let guardB: { token: string; userId: string };
  let supervisor: { token: string; userId: string };
  let resident: string;
  let mainGate: string;
  let backGate: string;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const url = (path: string) => `/v1/estates/${estateId}${path}`;

  async function staff(phone: string, role: string) {
    const userId = await stack.createUser(phone);
    await stack.addMember(estateId, userId, role);
    const token = (await signIn(stack, phone, WEB_DEVICE)).accessToken;
    await stack.db.owner.query(
      `update platform.sessions set mfa_verified_at = now() where user_id = $1`,
      [userId],
    );
    return { token, userId };
  }

  beforeAll(async () => {
    stack = await startTestStack();
    estateId = await stack.createEstate('Shift Estate');
    guardA = await staff('+2348039000001', 'security_officer');
    guardB = await staff('+2348039000002', 'security_officer');
    supervisor = await staff('+2348039000003', 'security_supervisor');
    const gate = async (name: string) =>
      (
        await stack.http
          .post(url('/gates'))
          .set(as(supervisor.token))
          .send({ name, type: 'both' })
          .expect(201)
      ).body.data.id as string;
    mainGate = await gate('Main gate');
    backGate = await gate('Back gate');
    const residentId = await stack.createUser('+2348039000010');
    await stack.addMember(estateId, residentId, 'tenant');
    resident = (await signIn(stack, '+2348039000010')).accessToken;
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  let shiftId: string;

  it('starts a shift, and starting again at the same gate resumes it', async () => {
    const first = await stack.http
      .post(url('/shift-sessions/start'))
      .set(as(guardA.token))
      .send({ gateId: mainGate })
      .expect(200);
    shiftId = first.body.data.id;
    expect(first.body.data).toMatchObject({ gateName: 'Main gate', endedAt: null });
    const again = await stack.http
      .post(url('/shift-sessions/start'))
      .set(as(guardA.token))
      .send({ gateId: mainGate })
      .expect(200);
    expect(again.body.data.id).toBe(shiftId);
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.outbox_events where type = 'security.shift.started'`,
      ),
    ).toBe(1);
  });

  it('refuses a second open shift at another gate', async () => {
    const conflict = await stack.http
      .post(url('/shift-sessions/start'))
      .set(as(guardA.token))
      .send({ gateId: backGate })
      .expect(409);
    expect(conflict.body.error.code).toBe('SHIFT_ALREADY_OPEN');
  });

  it('keeps residents out of gate shifts', async () => {
    await stack.http
      .post(url('/shift-sessions/start'))
      .set(as(resident))
      .send({ gateId: mainGate })
      .expect(403);
  });

  it('requires a handover note and only lets guards end their own shift', async () => {
    await stack.http
      .post(url(`/shift-sessions/${shiftId}/end`))
      .set(as(guardA.token))
      .send({ handoverNote: '' })
      .expect(400);
    await stack.http
      .post(url(`/shift-sessions/${shiftId}/end`))
      .set(as(guardB.token))
      .send({ handoverNote: 'Not mine' })
      .expect(404);
    const ended = await stack.http
      .post(url(`/shift-sessions/${shiftId}/end`))
      .set(as(guardA.token))
      .send({ handoverNote: 'Delivery van for C-4 still inside' })
      .expect(200);
    expect(ended.body.data).toMatchObject({ endedBy: guardA.userId });
    expect(ended.body.data.endedAt).not.toBeNull();
    await stack.http
      .post(url(`/shift-sessions/${shiftId}/end`))
      .set(as(guardA.token))
      .send({ handoverNote: 'Again' })
      .expect(409);
  });

  it('shows the next guard the last handover at the gate', async () => {
    const current = await stack.http
      .get(url('/shift-sessions/current'))
      .query({ gateId: mainGate })
      .set(as(guardB.token))
      .expect(200);
    expect(current.body.data).toMatchObject({
      mine: null,
      previous: { userId: guardA.userId, handoverNote: 'Delivery van for C-4 still inside' },
      openIncidents: 0,
    });
  });

  it('lets a supervisor end any shift remotely and list attendance', async () => {
    const open = await stack.http
      .post(url('/shift-sessions/start'))
      .set(as(guardB.token))
      .send({ gateId: backGate })
      .expect(200);
    await stack.http.get(url('/shift-sessions')).set(as(guardB.token)).expect(403);
    const remote = await stack.http
      .post(url(`/shift-sessions/${open.body.data.id}/end`))
      .set(as(supervisor.token))
      .send({ handoverNote: 'Ended by supervisor: guard went home sick' })
      .expect(200);
    expect(remote.body.data.endedBy).toBe(supervisor.userId);
    const attendance = await stack.http
      .get(url('/shift-sessions'))
      .query({ limit: 1 })
      .set(as(supervisor.token))
      .expect(200);
    expect(attendance.body.data).toHaveLength(1);
    expect(attendance.body.meta.nextCursor).toBeTruthy();
    const page2 = await stack.http
      .get(url('/shift-sessions'))
      .query({ limit: 1, cursor: attendance.body.meta.nextCursor })
      .set(as(supervisor.token))
      .expect(200);
    expect(page2.body.data[0].id).not.toBe(attendance.body.data[0].id);
  });

  it('has no delete for the app role', async () => {
    const app = stack.db.createAppClient({ max: 1 });
    await expect(
      app.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`select set_config('app.estate_id', '${estateId}', true)`);
        await tx.$executeRawUnsafe(`delete from tenant.shift_sessions`);
      }),
    ).rejects.toThrow();
  });
});
