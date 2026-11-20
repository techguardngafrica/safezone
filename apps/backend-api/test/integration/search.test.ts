import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

/** Global search (management-web.md §5): estate-wide records need staff permissions. */
describe('global search', () => {
  let stack: TestStack;
  let estateId: string;
  let otherEstateId: string;
  let admin: string;
  let tenant: string;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    stack = await startTestStack();
    estateId = await stack.createEstate('Search Estate');
    otherEstateId = await stack.createEstate('Elsewhere');
    const adminId = await stack.createUser('+2348037400001');
    await stack.addMember(estateId, adminId, 'estate_administrator');
    await stack.addMember(estateId, adminId, 'estate_accountant');
    admin = (await signIn(stack, '+2348037400001', WEB_DEVICE)).accessToken;
    await stack.db.owner.query(
      `update platform.sessions set mfa_verified_at = now() where user_id = $1`,
      [adminId],
    );

    const unit = await stack.http
      .post(`/v1/estates/${estateId}/spaces`)
      .set(as(admin))
      .send({ type: 'unit', code: 'S-1', unitType: 'flat' })
      .expect(201);
    await stack.http
      .post(`/v1/estates/${estateId}/occupancies`)
      .set(as(admin))
      .send({
        spaceId: unit.body.data.id,
        type: 'tenant',
        head: { fullName: 'Tola Adeyemi', phone: '+2348037400002' },
      })
      .expect(201);
    const due = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    await stack.http
      .post(`/v1/estates/${estateId}/invoices`)
      .set(as(admin))
      .send({
        spaceId: unit.body.data.id,
        description: 'Service charge',
        dueDate: due,
        lines: [{ description: 'Service charge', unitAmount: 1_000_000 }],
      })
      .expect(201);

    // A different resident of the same estate, holding the resident role's own invoice.read.
    const neighbourId = await stack.createUser('+2348037400003');
    await stack.addMember(estateId, neighbourId, 'tenant');
    await stack.resetRateLimits();
    tenant = (await signIn(stack, '+2348037400003')).accessToken;
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('shows staff the estate’s residents and invoices', async () => {
    const people = await stack.http
      .get(`/v1/estates/${estateId}/search?q=Tola`)
      .set(as(admin))
      .expect(200);
    expect(people.body.data.hits.map((hit: { kind: string }) => hit.kind)).toContain('resident');
    const invoices = await stack.http
      .get(`/v1/estates/${estateId}/search?q=INV`)
      .set(as(admin))
      .expect(200);
    expect(invoices.body.data.hits.some((hit: { kind: string }) => hit.kind === 'invoice')).toBe(
      true,
    );
  });

  it('never lists other households’ invoices or residents to a resident', async () => {
    for (const q of ['INV', 'Tola']) {
      const response = await stack.http
        .get(`/v1/estates/${estateId}/search?q=${q}`)
        .set(as(tenant))
        .expect(200);
      const kinds = response.body.data.hits.map((hit: { kind: string }) => hit.kind);
      expect(kinds).not.toContain('invoice');
      expect(kinds).not.toContain('resident');
    }
  });

  it('is invisible across estates', async () => {
    await stack.http.get(`/v1/estates/${otherEstateId}/search?q=Tola`).set(as(admin)).expect(404);
  });
});
