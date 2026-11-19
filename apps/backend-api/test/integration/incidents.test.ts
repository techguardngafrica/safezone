import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/common/ids/uuidv7';
import { countRows, signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

describe('security incidents', () => {
  let stack: TestStack;
  let estateId: string;
  let manager: { token: string; userId: string };
  let guard: { token: string; userId: string };
  let otherGuard: { token: string; userId: string };
  let resident: string;
  let gateId: string;
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

  /** A finished evidence upload, as the files module records it. */
  async function evidenceFile(
    uploadedBy: string,
    sha256 = 'a'.repeat(64),
    purpose = 'incident_evidence',
  ) {
    const id = uuidv7();
    await stack.db.owner.query(
      `insert into platform.files (id, estate_id, purpose, storage_key, mime_type, size_bytes, sha256,
         scan_status, uploaded_by, uploaded_at)
       values ($1, $2, $3, $4, 'image/jpeg', 1000, $5, 'clean', $6, now())`,
      [id, estateId, purpose, `test/${id}`, sha256, uploadedBy],
    );
    return id;
  }

  const report = (overrides: Record<string, unknown> = {}) => ({
    category: 'suspicious_activity',
    severity: 'medium',
    title: 'Man watching houses',
    description: 'Seen walking past block C three times',
    locationKind: 'gate',
    gateId,
    occurredAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    ...overrides,
  });

  beforeAll(async () => {
    stack = await startTestStack();
    estateId = await stack.createEstate('Incident Estate');
    manager = await staff('+2348038000001', 'estate_manager');
    guard = await staff('+2348038000002', 'security_officer');
    otherGuard = await staff('+2348038000003', 'security_officer');
    const admin = await staff('+2348038000004', 'estate_administrator');
    gateId = (
      await stack.http
        .post(url('/gates'))
        .set(as(admin.token))
        .send({ name: 'Main gate', type: 'both' })
        .expect(201)
    ).body.data.id;
    const residentId = await stack.createUser('+2348038000010');
    await stack.addMember(estateId, residentId, 'tenant');
    resident = (await signIn(stack, '+2348038000010')).accessToken;
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  let incidentId: string;

  it('lets a guard report an incident with evidence and records the file hash', async () => {
    const fileId = await evidenceFile(guard.userId, 'b'.repeat(64));
    const response = await stack.http
      .post(url('/incidents'))
      .set(as(guard.token))
      .send(report({ evidenceFileIds: [fileId] }))
      .expect(201);
    const incident = response.body.data;
    incidentId = incident.id;
    expect(incident).toMatchObject({
      status: 'reported',
      reporterType: 'guard',
      gateName: 'Main gate',
      evidenceCount: 1,
      version: 1,
    });
    expect(incident.evidence[0]).toMatchObject({
      fileId,
      sha256: 'b'.repeat(64),
      uploadedBy: guard.userId,
      addedBy: guard.userId,
    });
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.outbox_events where type = 'security.incident.reported' and aggregate_id = $1`,
        [incidentId],
      ),
    ).toBe(1);
  });

  it('rejects evidence the reporter did not upload, or of another purpose', async () => {
    const someoneElses = await evidenceFile(otherGuard.userId);
    await stack.http
      .post(url('/incidents'))
      .set(as(guard.token))
      .send(report({ evidenceFileIds: [someoneElses] }))
      .expect(422);
    const maintenancePhoto = await evidenceFile(guard.userId, 'c'.repeat(64), 'maintenance');
    const rejected = await stack.http
      .post(url('/incidents'))
      .set(as(guard.token))
      .send(report({ evidenceFileIds: [maintenancePhoto] }))
      .expect(422);
    expect(rejected.body.error.code).toBe('EVIDENCE_INVALID');
  });

  it('validates location and time', async () => {
    await stack.http
      .post(url('/incidents'))
      .set(as(guard.token))
      .send(report({ gateId: undefined }))
      .expect(400);
    await stack.http
      .post(url('/incidents'))
      .set(as(guard.token))
      .send(report({ locationKind: 'common_area', gateId: undefined }))
      .expect(400);
    const future = await stack.http
      .post(url('/incidents'))
      .set(as(guard.token))
      .send(report({ occurredAt: new Date(Date.now() + 3_600_000).toISOString() }))
      .expect(422);
    expect(future.body.error.code).toBe('INCIDENT_IN_FUTURE');
    await stack.http
      .post(url('/incidents'))
      .set(as(guard.token))
      .send(report({ gateId: uuidv7() }))
      .expect(404);
  });

  it('shows reporters only their own incidents; managers see all', async () => {
    await stack.http
      .post(url('/incidents'))
      .set(as(resident))
      .send(
        report({
          locationKind: 'common_area',
          gateId: undefined,
          locationText: 'Playground',
          title: 'Broken swing',
          category: 'damage',
        }),
      )
      .expect(201);
    const mine = await stack.http.get(url('/incidents')).set(as(resident)).expect(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({ reporterType: 'resident', title: 'Broken swing' });
    await stack.http
      .get(url(`/incidents/${incidentId}`))
      .set(as(resident))
      .expect(404);
    await stack.http
      .get(url(`/incidents/${incidentId}`))
      .set(as(otherGuard.token))
      .expect(404);
    const all = await stack.http.get(url('/incidents')).set(as(manager.token)).expect(200);
    expect(all.body.data).toHaveLength(2);
  });

  it('only managers move incidents, with version checks', async () => {
    await stack.http
      .post(url(`/incidents/${incidentId}/transition`))
      .set(as(guard.token))
      .send({ action: 'review', version: 1 })
      .expect(403);
    const reviewed = await stack.http
      .post(url(`/incidents/${incidentId}/transition`))
      .set(as(manager.token))
      .send({ action: 'review', version: 1 })
      .expect(200);
    expect(reviewed.body.data).toMatchObject({ status: 'under_review', version: 2 });
    const stale = await stack.http
      .post(url(`/incidents/${incidentId}/transition`))
      .set(as(manager.token))
      .send({ action: 'resolve', version: 1, resolution: 'Spoke to him' })
      .expect(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    const invalid = await stack.http
      .post(url(`/incidents/${incidentId}/transition`))
      .set(as(manager.token))
      .send({ action: 'close', version: 2 })
      .expect(409);
    expect(invalid.body.error.code).toBe('INCIDENT_TRANSITION_INVALID');
  });

  it('assigns to estate security staff only, and the assignee can then see it', async () => {
    const outsider = await stack.createUser('+2348038000099');
    await stack.http
      .post(url(`/incidents/${incidentId}/transition`))
      .set(as(manager.token))
      .send({ action: 'assign', version: 2, assigneeId: outsider })
      .expect(422);
    await stack.http
      .post(url(`/incidents/${incidentId}/transition`))
      .set(as(manager.token))
      .send({ action: 'assign', version: 2, assigneeId: otherGuard.userId })
      .expect(200);
    const seen = await stack.http
      .get(url(`/incidents/${incidentId}`))
      .set(as(otherGuard.token))
      .expect(200);
    expect(seen.body.data).toMatchObject({ status: 'assigned', assignedTo: otherGuard.userId });
  });

  it('appends notes and evidence, resolves, closes, then refuses additions', async () => {
    await stack.http
      .post(url(`/incidents/${incidentId}/notes`))
      .set(as(otherGuard.token))
      .send({ body: 'Checked CCTV at 10:40' })
      .expect(200);
    const extra = await evidenceFile(otherGuard.userId, 'd'.repeat(64));
    await stack.http
      .post(url(`/incidents/${incidentId}/evidence`))
      .set(as(otherGuard.token))
      .send({ fileIds: [extra] })
      .expect(200);
    await stack.http
      .post(url(`/incidents/${incidentId}/transition`))
      .set(as(manager.token))
      .send({ action: 'resolve', version: 3, resolution: 'Visitor of unit C-4, cleared' })
      .expect(200);
    const closed = await stack.http
      .post(url(`/incidents/${incidentId}/transition`))
      .set(as(manager.token))
      .send({ action: 'close', version: 4 })
      .expect(200);
    expect(closed.body.data).toMatchObject({ status: 'closed', evidenceCount: 2 });
    expect(
      closed.body.data.notes.map(
        (n: { kind: string; toStatus: string | null }) => n.toStatus ?? n.kind,
      ),
    ).toEqual(['under_review', 'assigned', 'note', 'resolved', 'closed']);
    await stack.http
      .post(url(`/incidents/${incidentId}/notes`))
      .set(as(guard.token))
      .send({ body: 'Late note' })
      .expect(409);
  });

  it('keeps notes and evidence append-only and incidents undeletable for the app role', async () => {
    const app = stack.db.createAppClient({ max: 1 });
    await expect(
      app.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`select set_config('app.estate_id', '${estateId}', true)`);
        await tx.$executeRawUnsafe(`update tenant.incident_notes set body = 'changed'`);
      }),
    ).rejects.toThrow();
    await expect(
      app.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`select set_config('app.estate_id', '${estateId}', true)`);
        await tx.$executeRawUnsafe(`delete from tenant.incidents where id = '${incidentId}'`);
      }),
    ).rejects.toThrow();
  });

  it('alerts managers at once for a critical incident', async () => {
    const response = await stack.http
      .post(url('/incidents'))
      .set(as(guard.token))
      .send(report({ severity: 'critical', category: 'fight', title: 'Fight at the gate' }))
      .expect(201);
    const rows = await stack.db.owner.query<{ payload: { intent: string; userIds: string[] } }>(
      `select payload from platform.outbox_events where type = 'notifications.request.created'
         and payload->>'dedupeKey' = $1`,
      [`incident:${response.body.data.id}:critical`],
    );
    expect(rows.rows[0]?.payload.intent).toBe('security.incident_critical');
    expect(rows.rows[0]?.payload.userIds).toContain(manager.userId);
    expect(rows.rows[0]?.payload.userIds).not.toContain(guard.userId);
  });
});
