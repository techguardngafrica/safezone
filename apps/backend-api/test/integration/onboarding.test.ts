import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/common/ids/uuidv7';
import { OutboxRelay } from '../../src/common/outbox/outbox-relay';
import { EmailSender, FakeEmailSender } from '../../src/integrations/email/email-sender';
import { FakeSmsSender } from '../../src/integrations/sms/fake-sms.sender';
import { SmsSender } from '../../src/integrations/sms/sms-sender';
import { WorkerModule } from '../../src/worker/worker.module';
import { builtInRoleId } from '../../src/scripts/seed-roles';
import { countRows, signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('condition not met in time');
}

const SUPER_ADMIN_DEVICE = { app: 'super-admin', platform: 'web', appVersion: '1.0.0' } as const;

describe('estate onboarding', () => {
  let stack: TestStack;
  let worker: INestApplicationContext;
  let relay: OutboxRelay;
  const workerSms = new FakeSmsSender();
  const workerEmail = new FakeEmailSender();
  let reviewerToken: string;
  let reviewerId: string;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** A clean personal file owned by the user, as if uploaded and scanned. */
  async function cleanFile(userId: string, status = 'clean'): Promise<string> {
    const id = uuidv7();
    await stack.db.owner.query(
      `insert into platform.files (id, estate_id, purpose, storage_key, mime_type, size_bytes, scan_status, uploaded_by)
       values ($1, null, 'estate_application', $2, 'application/pdf', 1000, $3, $4)`,
      [id, `users/${userId}/${id}`, status, userId],
    );
    return id;
  }

  async function verifyMfa(userId: string) {
    await stack.db.owner.query(
      `update platform.sessions set mfa_verified_at = now() where user_id = $1`,
      [userId],
    );
  }

  const application = (documentFileIds: string[]) => ({
    representative: { fullName: 'Ada Obi', email: 'ada@example.com', role: 'manager' },
    estate: {
      name: 'Palm Grove Estate',
      address: '12 Palm Grove Road, Lekki',
      state: 'Lagos',
      lga: 'Eti-Osa',
      location: { lat: 6.4474, lng: 3.4723 },
      type: 'gated_houses',
      unitsEstimate: 120,
      gatesEstimate: 2,
    },
    documentFileIds,
    acceptedTerms: true,
  });

  beforeAll(async () => {
    stack = await startTestStack();
    process.env.OUTBOX_RELAY_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(SmsSender)
      .useValue(workerSms)
      .overrideProvider(EmailSender)
      .useValue(workerEmail)
      .compile();
    worker = moduleRef.createNestApplication();
    await (worker as unknown as { init(): Promise<void> }).init();
    relay = worker.get(OutboxRelay);

    reviewerId = await stack.createUser('+2348036000001', 'Techguard Reviewer');
    await stack.assignPlatformRole(reviewerId, 'platform_administrator');
    reviewerToken = (await signIn(stack, '+2348036000001', SUPER_ADMIN_DEVICE)).accessToken;
    await verifyMfa(reviewerId);
  });

  afterAll(async () => {
    await worker?.close();
    await stack?.stop();
  });

  it('self-service: apply, request info, resubmit, approve into an Estate Administrator', async () => {
    await stack.resetRateLimits();
    const applicant = await signIn(stack, '+2348036000002', WEB_DEVICE);
    const applicantId = applicant.user.id;
    const auth = as(applicant.accessToken);

    // Documents must be the applicant's own usable uploads.
    const stranger = await stack.createUser('+2348036000099');
    const strangersFile = await cleanFile(stranger);
    await stack.http
      .post('/v1/me/estate-applications')
      .set(auth)
      .send(application([strangersFile]))
      .expect(422);
    const infected = await cleanFile(applicantId, 'infected');
    await stack.http
      .post('/v1/me/estate-applications')
      .set(auth)
      .send(application([infected]))
      .expect(422);
    await stack.http
      .post('/v1/me/estate-applications')
      .set(auth)
      .send({ ...application([]), documentFileIds: [] })
      .expect(400);

    const pendingScan = await cleanFile(applicantId, 'pending_scan');
    const submitted = await stack.http
      .post('/v1/me/estate-applications')
      .set(auth)
      .send(application([pendingScan]))
      .expect(201);
    const applicationId: string = submitted.body.data.id;
    expect(submitted.body.data).toMatchObject({ status: 'submitted', estateId: null });

    // Residents and applicants cannot use the review queue.
    await stack.http.get('/v1/platform/estate-applications').set(auth).expect(403);

    const queue = await stack.http
      .get('/v1/platform/estate-applications')
      .query({ status: 'submitted' })
      .set(as(reviewerToken))
      .expect(200);
    expect(queue.body.data.map((item: { id: string }) => item.id)).toContain(applicationId);

    // Duplicate check flags an existing estate with the same name in the same state.
    const existing = await stack.createEstate('Palm Grove');
    await stack.db.owner.query(`update platform.estates set state = 'Lagos' where id = $1`, [
      existing,
    ]);
    const review = await stack.http
      .get(`/v1/platform/estate-applications/${applicationId}`)
      .set(as(reviewerToken))
      .expect(200);
    expect(review.body.data.applicantPhone).toBe('+2348036000002');
    expect(review.body.data.duplicates).toEqual([
      expect.objectContaining({ kind: 'estate', id: existing, reason: 'same_name' }),
    ]);

    // Approval needs a clean document: the only one is still being scanned.
    await stack.http
      .post(`/v1/platform/estate-applications/${applicationId}/start-review`)
      .set(as(reviewerToken))
      .expect(200);
    const blocked = await stack.http
      .post(`/v1/platform/estate-applications/${applicationId}/approve`)
      .set(as(reviewerToken))
      .expect(422);
    expect(blocked.body.error.code).toBe('APPLICATION_DOCUMENTS_MISSING');

    await stack.http
      .post(`/v1/platform/estate-applications/${applicationId}/request-info`)
      .set(as(reviewerToken))
      .send({ reason: 'Please upload the deed of assignment.' })
      .expect(200);
    // Approve is not allowed while waiting for the applicant.
    await stack.http
      .post(`/v1/platform/estate-applications/${applicationId}/approve`)
      .set(as(reviewerToken))
      .expect(409);

    const deed = await cleanFile(applicantId);
    const resubmitted = await stack.http
      .post(`/v1/me/estate-applications/${applicationId}/resubmit`)
      .set(auth)
      .send({ documentFileIds: [deed], note: 'Deed attached' })
      .expect(200);
    expect(resubmitted.body.data.status).toBe('submitted');
    expect(resubmitted.body.data.documents).toHaveLength(2);

    const approved = await stack.http
      .post(`/v1/platform/estate-applications/${applicationId}/approve`)
      .set(as(reviewerToken))
      .expect(200);
    const estateId: string = approved.body.data.estateId;
    expect(approved.body.data.status).toBe('approved');
    expect(estateId).toEqual(expect.any(String));

    // A second approval is refused, and exactly one administrator role exists.
    await stack.http
      .post(`/v1/platform/estate-applications/${applicationId}/approve`)
      .set(as(reviewerToken))
      .expect(409);
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.role_assignments where estate_id = $1 and role_id = $2 and revoked_at is null`,
        [estateId, builtInRoleId('estate_administrator')],
      ),
    ).toBe(1);

    // The applicant now administers the estate: two-step verification first, then the setup wizard.
    const mfaGate = await stack.http
      .get(`/v1/estates/${estateId}/setup-progress`)
      .set(auth)
      .expect(403);
    expect(mfaGate.body.error.code).toBe('MFA_REQUIRED');
    await verifyMfa(applicantId);
    const memberships = await stack.http.get('/v1/me/memberships').set(auth).expect(200);
    expect(memberships.body.data).toEqual([
      expect.objectContaining({
        estate: expect.objectContaining({ id: estateId, status: 'approved' }),
        roles: ['estate_administrator'],
      }),
    ]);
    const progress = await stack.http
      .get(`/v1/estates/${estateId}/setup-progress`)
      .set(auth)
      .expect(200);
    expect(progress.body.data).toMatchObject({ estateStatus: 'approved', canActivate: false });

    // The reviewer's document download is audited.
    const download = await stack.http
      .get(`/v1/platform/estate-applications/${applicationId}/documents/${deed}/download-url`)
      .set(as(reviewerToken))
      .expect(200);
    expect(download.body.data.url).toEqual(expect.any(String));
    await stack.http
      .get(
        `/v1/platform/estate-applications/${applicationId}/documents/${strangersFile}/download-url`,
      )
      .set(as(reviewerToken))
      .expect(404);

    // Applicant notifications are queued for every decision.
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.outbox_events where type = 'notifications.request.created'
          and payload->>'dedupeKey' like $1`,
        [`application:${applicationId}:%`],
      ),
    ).toBe(3);
  });

  it('setup: verified steps, then activation', async () => {
    await stack.resetRateLimits();
    const estateId = await stack.createEstate('Setup Estate');
    await stack.db.owner.query(`update platform.estates set status = 'approved' where id = $1`, [
      estateId,
    ]);
    const adminId = await stack.createUser('+2348036000010');
    await stack.addMember(estateId, adminId, 'estate_administrator');
    const token = (await signIn(stack, '+2348036000010', WEB_DEVICE)).accessToken;
    await verifyMfa(adminId);
    const base = `/v1/estates/${estateId}/setup-progress`;

    const tooEarly = await stack.http.post(`${base}/activate`).set(as(token)).expect(422);
    expect(tooEarly.body.error.code).toBe('SETUP_INCOMPLETE');
    const noSupervisor = await stack.http
      .post(`${base}/security_supervisor/complete`)
      .set(as(token))
      .expect(422);
    expect(noSupervisor.body.error.code).toBe('SETUP_STEP_INCOMPLETE');

    const supervisorId = await stack.createUser('+2348036000011');
    await stack.addMember(estateId, supervisorId, 'security_supervisor');
    await stack.http
      .post(`/v1/estates/${estateId}/spaces`)
      .set(as(token))
      .send({ type: 'unit', code: 'H1', unitType: 'house' })
      .expect(201);
    const noGate = await stack.http.post(`${base}/gates/complete`).set(as(token)).expect(422);
    expect(noGate.body.error.code).toBe('SETUP_STEP_INCOMPLETE');
    await stack.http
      .post(`/v1/estates/${estateId}/gates`)
      .set(as(token))
      .send({ name: 'Main Gate', type: 'both' })
      .expect(201);
    for (const step of ['spaces', 'gates', 'security_supervisor', 'sos_policy']) {
      await stack.http.post(`${base}/${step}/complete`).set(as(token)).expect(200);
    }
    await stack.http.post(`${base}/bogus/complete`).set(as(token)).expect(400);
    const activated = await stack.http.post(`${base}/activate`).set(as(token)).expect(200);
    expect(activated.body.data).toMatchObject({ estateStatus: 'active', missing: [] });
    await stack.http.post(`${base}/activate`).set(as(token)).expect(409);
  });

  it('assisted: lead, create estate, invite, accept with the invited phone only', async () => {
    await stack.resetRateLimits();
    const lead = await stack.http
      .post('/v1/public/onboarding-leads')
      .send({
        name: 'Chidi Okafor',
        phone: '+2348036000020',
        estateName: 'Cedar Court',
        location: 'Gwarinpa, Abuja',
        unitsEstimate: 60,
      })
      .expect(201);
    const leadId: string = lead.body.data.id;

    const created = await stack.http
      .post('/v1/platform/estates')
      .set(as(reviewerToken))
      .send({
        name: 'Cedar Court',
        type: 'apartment_complex',
        address: '4 Cedar Close, Gwarinpa',
        state: 'FCT',
        lga: 'AMAC',
        leadId,
      })
      .expect(201);
    const estateId: string = created.body.data.id;
    expect(created.body.data).toMatchObject({ status: 'approved', onboardingMode: 'assisted' });
    expect(created.body.data.code).toMatch(/^[A-Z2-9]{6}$/);
    await stack.http
      .post('/v1/platform/estates')
      .set(as(reviewerToken))
      .send({
        name: 'Again',
        type: 'mixed',
        address: '1 Some Road',
        state: 'FCT',
        lga: 'AMAC',
        leadId,
      })
      .expect(409);

    const invitation = await stack.http
      .post(`/v1/platform/estates/${estateId}/invitations`)
      .set(as(reviewerToken))
      .send({ phone: '+2348036000020', email: 'chidi@example.com' })
      .expect(201);
    expect(invitation.body.data).toMatchObject({
      status: 'pending',
      roleKey: 'estate_administrator',
    });
    expect(invitation.body.data.phone).not.toBe('+2348036000020');

    // The worker sends the link by SMS and email; the token is not stored anywhere.
    await waitFor(async () => {
      await relay.relayBatch();
      return workerSms.lastTo('+2348036000020') !== undefined && workerEmail.sent.length > 0;
    });
    const link = /\/invite\/([A-Za-z0-9_-]+)/.exec(workerSms.lastTo('+2348036000020')?.body ?? '');
    const token = link?.[1] ?? '';
    expect(token).toHaveLength(43);
    expect(workerEmail.sent.at(-1)?.text).toContain(token);
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.outbox_events where payload::text like $1`,
        [`%${token}%`],
      ),
    ).toBe(0);

    // Sending twice (job retry) does not send twice.
    await relay.relayBatch();
    expect(workerSms.sent.filter((message) => message.to === '+2348036000020')).toHaveLength(1);

    const preview = await stack.http.get(`/v1/public/invitations/${token}`).expect(200);
    expect(preview.body.data).toMatchObject({ estateName: 'Cedar Court', status: 'pending' });
    expect(preview.body.data.phoneMasked).not.toContain('6000020');
    await stack.http.get(`/v1/public/invitations/${'x'.repeat(43)}`).expect(404);

    // Someone else signed in cannot accept it.
    const other = await signIn(stack, '+2348036000021', WEB_DEVICE);
    const mismatch = await stack.http
      .post(`/v1/invitations/${token}/accept`)
      .set(as(other.accessToken))
      .expect(403);
    expect(mismatch.body.error.code).toBe('INVITATION_PHONE_MISMATCH');

    const invitee = await signIn(stack, '+2348036000020', WEB_DEVICE);
    const accepted = await stack.http
      .post(`/v1/invitations/${token}/accept`)
      .set(as(invitee.accessToken))
      .expect(200);
    expect(accepted.body.data).toEqual({ estateId, roleKey: 'estate_administrator' });
    // Now a staff member: two-step verification is required before anything else.
    const mfa = await stack.http
      .post(`/v1/invitations/${token}/accept`)
      .set(as(invitee.accessToken))
      .expect(403);
    expect(mfa.body.error.code).toBe('MFA_REQUIRED');
    await verifyMfa(invitee.user.id);
    await stack.http
      .post(`/v1/invitations/${token}/accept`)
      .set(as(invitee.accessToken))
      .expect(409);

    const leads = await stack.http
      .get('/v1/platform/onboarding-leads')
      .set(as(reviewerToken))
      .expect(200);
    expect(leads.body.data.find((item: { id: string }) => item.id === leadId)).toMatchObject({
      status: 'converted',
      estateId,
    });
  });

  it('suspension keeps reads and safety actions, blocks management changes', async () => {
    await stack.resetRateLimits();
    const estateId = await stack.createEstate('Suspend Me');
    const adminId = await stack.createUser('+2348036000030');
    await stack.addMember(estateId, adminId, 'estate_administrator');
    const token = (await signIn(stack, '+2348036000030', WEB_DEVICE)).accessToken;
    await verifyMfa(adminId);

    await stack.http
      .post(`/v1/platform/estates/${estateId}/suspend`)
      .set(as(reviewerToken))
      .send({ reason: 'Unpaid onboarding paperwork' })
      .expect(200);
    await stack.http.get(`/v1/estates/${estateId}`).set(as(token)).expect(200);
    const blocked = await stack.http
      .patch(`/v1/estates/${estateId}/settings`)
      .set(as(token))
      .send({ 'visitor.require_photo': true })
      .expect(403);
    expect(blocked.body.error.code).toBe('ESTATE_SUSPENDED');

    const reactivated = await stack.http
      .post(`/v1/platform/estates/${estateId}/reactivate`)
      .set(as(reviewerToken))
      .send({ reason: 'Paperwork received' })
      .expect(200);
    expect(reactivated.body.data.status).toBe('active');
    await stack.http
      .patch(`/v1/estates/${estateId}/settings`)
      .set(as(token))
      .send({ 'visitor.require_photo': true })
      .expect(200);
    await stack.http
      .post(`/v1/platform/estates/${estateId}/reactivate`)
      .set(as(reviewerToken))
      .send({ reason: 'Twice is wrong' })
      .expect(409);

    // Lifecycle changes are audited.
    await waitFor(async () => {
      await relay.relayBatch();
      return (
        (await countRows(
          stack.db.owner,
          `select count(*) from audit.audit_events where resource_id = $1 and action like 'tenancy.estate.%'`,
          [estateId],
        )) === 2
      );
    });
  });
});
