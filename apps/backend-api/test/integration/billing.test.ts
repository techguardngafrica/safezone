import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/common/database/tenant-context';
import { BillingJobsService } from '../../src/modules/billing/billing-jobs.service';
import { InvoicesService } from '../../src/modules/billing/invoices.service';
import { countRows, signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

describe('billing core', () => {
  let stack: TestStack;
  let estateId: string;
  let otherEstateId: string;
  let manager: string;
  let accountant: string;
  let flatResident: string;
  let houseResident: string;
  let flatResidentId: string;
  let flatId: string;
  let houseId: string;
  let vacantId: string;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const url = (path: string) => `/v1/estates/${estateId}${path}`;

  async function staff(phone: string, role: string, estate = estateId) {
    const userId = await stack.createUser(phone);
    await stack.addMember(estate, userId, role);
    const token = (await signIn(stack, phone, WEB_DEVICE)).accessToken;
    await stack.db.owner.query(
      `update platform.sessions set mfa_verified_at = now() where user_id = $1`,
      [userId],
    );
    return token;
  }

  beforeAll(async () => {
    stack = await startTestStack();
    estateId = await stack.createEstate('Ledger Estate');
    otherEstateId = await stack.createEstate('Other Estate');
    manager = await staff('+2348033000001', 'estate_manager');
    accountant = await staff('+2348033000002', 'estate_accountant');
    await stack.addMember(
      estateId,
      await stack.createUser('+2348033000003'),
      'estate_administrator',
    );

    const owner = (await signIn(stack, '+2348033000003', WEB_DEVICE)).accessToken;
    await stack.db.owner.query(
      `update platform.sessions set mfa_verified_at = now() where user_id in (select id from platform.users where phone_e164 = '+2348033000003')`,
    );
    const unit = async (body: Record<string, unknown>) =>
      (await stack.http.post(url('/spaces')).set(as(owner)).send(body).expect(201)).body.data
        .id as string;
    flatId = await unit({ type: 'unit', code: 'A-1', unitType: 'flat', bedrooms: 3 });
    houseId = await unit({ type: 'unit', code: 'H-1', unitType: 'house', bedrooms: 5 });
    vacantId = await unit({ type: 'unit', code: 'V-1', unitType: 'house' });
    await stack.http
      .post(url('/occupancies'))
      .set(as(manager))
      .send({
        spaceId: flatId,
        type: 'tenant',
        head: { fullName: 'Ada Flat', phone: '+2348033000010' },
        startsOn: '2026-01-01',
      })
      .expect(201);
    await stack.http
      .post(url('/occupancies'))
      .set(as(manager))
      .send({
        spaceId: houseId,
        type: 'owner_occupier',
        head: { fullName: 'Bayo House', phone: '+2348033000011' },
        startsOn: '2027-01-17',
      })
      .expect(201);
    const flatSession = await signIn(stack, '+2348033000010');
    flatResident = flatSession.accessToken;
    flatResidentId = flatSession.user.id;
    houseResident = (await signIn(stack, '+2348033000011')).accessToken;
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  let duesId: string;
  let levyId: string;
  let runId: string;

  it('defines charges (charge.manage only)', async () => {
    await stack.http
      .post(url('/charges'))
      .set(as(manager))
      .send({
        type: 'estate_dues',
        name: 'Dues',
        amountRule: { kind: 'fixed', amount: 3_100_000 },
        frequency: 'monthly',
        startsOn: '2026-01-01',
      })
      .expect(403);
    duesId = (
      await stack.http
        .post(url('/charges'))
        .set(as(accountant))
        .send({
          type: 'estate_dues',
          name: 'Monthly dues',
          amountRule: { kind: 'per_unit_type', amounts: { flat: 3_100_000, house: 6_200_000 } },
          frequency: 'monthly',
          startsOn: '2026-01-01',
        })
        .expect(201)
    ).body.data.id;
    levyId = (
      await stack.http
        .post(url('/charges'))
        .set(as(accountant))
        .send({
          type: 'security_levy',
          name: 'Security levy',
          amountRule: { kind: 'per_bedroom', amount: 100_000 },
          frequency: 'monthly',
          startsOn: '2026-01-01',
          appliesTo: { unitTypes: ['flat'] },
        })
        .expect(201)
    ).body.data.id;
    const list = await stack.http.get(url('/charges')).set(as(flatResident)).expect(200);
    expect(list.body.data).toHaveLength(2);
  });

  it('previews, needs a second approver, and issues a run with proration', async () => {
    runId = (
      await stack.http
        .post(url('/billing-runs'))
        .set(as(accountant))
        .send({
          label: 'January 2027',
          periodStart: '2027-01-01',
          periodEnd: '2027-01-31',
          dueDate: '2027-01-14',
          chargeIds: [duesId, levyId],
        })
        .expect(201)
    ).body.data.id;
    await stack.http
      .post(url(`/billing-runs/${runId}/submit`))
      .set(as(accountant))
      .expect(409);
    const preview = await stack.http
      .post(url(`/billing-runs/${runId}/preview`))
      .set(as(accountant))
      .expect(200);
    // Flat: 31,000 + 3 × 1,000 levy; house moved in on the 17th: 62,000 × 15/31 = 30,000.
    expect(preview.body.data.totals).toEqual({
      invoices: 2,
      amount: 3_100_000 + 300_000 + 3_000_000,
      skippedUnits: 1,
    });
    const items = await stack.http
      .get(url(`/billing-runs/${runId}/items`))
      .set(as(accountant))
      .expect(200);
    expect(
      items.body.data.map(
        (item: { unitCode: string; skipReason: string | null; amount: number }) => [
          item.unitCode,
          item.skipReason,
          item.amount,
        ],
      ),
    ).toEqual([
      ['A-1', null, 3_400_000],
      ['H-1', null, 3_000_000],
      ['V-1', 'vacant', 0],
    ]);
    expect(items.body.data[1].lines[0].description).toBe('Monthly dues (15 of 31 days)');

    const submitted = await stack.http
      .post(url(`/billing-runs/${runId}/submit`))
      .set(as(accountant))
      .expect(200);
    expect(submitted.body.data.status).toBe('awaiting_approval');
    await stack.http
      .post(url(`/billing-runs/${runId}/issue`))
      .set(as(accountant))
      .expect(409);
    await stack.http
      .post(url(`/billing-runs/${runId}/approve`))
      .set(as(accountant))
      .expect(403);
    await stack.http
      .post(url(`/billing-runs/${runId}/approve`))
      .set(as(manager))
      .expect(200);
    const issued = await stack.http
      .post(url(`/billing-runs/${runId}/issue`))
      .set(as(accountant))
      .expect(200);
    expect(issued.body.data).toMatchObject({ status: 'issued', totals: { invoices: 2 } });
    await stack.http
      .post(url(`/billing-runs/${runId}/cancel`))
      .set(as(accountant))
      .send({ reason: 'oops' })
      .expect(409);
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.outbox_events where type = 'billing.invoice.issued' and estate_id = $1`,
        [estateId],
      ),
    ).toBe(2);
  });

  it('shows residents only their own invoices and numbers them per estate', async () => {
    const mine = await stack.http.get(url('/invoices')).set(as(flatResident)).expect(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({
      unitCode: 'A-1',
      total: 3_400_000,
      balance: 3_400_000,
      status: 'issued',
    });
    const all = await stack.http.get(url('/invoices')).set(as(accountant)).expect(200);
    expect(all.body.data.map((invoice: { number: string }) => invoice.number).sort()).toEqual([
      'INV-000001',
      'INV-000002',
    ]);
    const houseInvoice = all.body.data.find(
      (invoice: { unitCode: string }) => invoice.unitCode === 'H-1',
    );
    await stack.http
      .get(url(`/invoices/${houseInvoice.id}`))
      .set(as(flatResident))
      .expect(404);
    await stack.http
      .get(url(`/invoices/${houseInvoice.id}`))
      .set(as(houseResident))
      .expect(200);
  });

  it('keeps issued invoices immutable and the ledger balanced in the database', async () => {
    await expect(
      stack.db.owner.query(`update tenant.invoices set total = total + 1 where estate_id = $1`, [
        estateId,
      ]),
    ).rejects.toThrow(/immutable/);
    await expect(
      stack.db.owner.query(`delete from tenant.ledger_entries where estate_id = $1`, [estateId]),
    ).rejects.toThrow(/append-only/);
    const client = await stack.db.owner.connect();
    try {
      await client.query('begin');
      const account = await client.query<{ id: string }>(
        `select id from tenant.ledger_accounts where estate_id = $1 limit 1`,
        [estateId],
      );
      const journal = await client.query<{ id: string }>(
        `insert into tenant.journals (id, estate_id, type, description, source_type, source_id)
         values (gen_random_uuid(), $1, 'adjustment', 'bad', 'test', 'x') returning id`,
        [estateId],
      );
      await client.query(
        `insert into tenant.ledger_entries (id, estate_id, journal_id, account_id, debit, credit)
         values (gen_random_uuid(), $1, $2, $3, 100, 0), (gen_random_uuid(), $1, $2, $3, 0, 99)`,
        [estateId, journal.rows[0]?.id, account.rows[0]?.id],
      );
      await expect(client.query('commit')).rejects.toThrow(/does not balance/);
    } finally {
      client.release();
    }
    const balances = await stack.http.get(url('/ledger/balances')).set(as(accountant)).expect(200);
    const rows = balances.body.data as { debit: number; credit: number; code: string }[];
    expect(rows.reduce((total, row) => total + row.debit, 0)).toBe(
      rows.reduce((total, row) => total + row.credit, 0),
    );
    expect(rows.find((row) => row.code === 'income:estate_dues')?.credit).toBe(6_100_000);
    await stack.http.get(url('/ledger/balances')).set(as(flatResident)).expect(403);
  });

  it('credit notes and waivers reduce the balance; waivers need a different approver', async () => {
    const [invoice] = (await stack.http.get(url('/invoices')).set(as(flatResident)).expect(200))
      .body.data;
    await stack.http
      .post(url(`/invoices/${invoice.id}/credit-notes`))
      .set(as(accountant))
      .send({ amount: 100_000, reason: 'Levy overcharged' })
      .expect(403);
    await stack.http
      .post(url(`/invoices/${invoice.id}/credit-notes`))
      .set(as(manager))
      .send({ amount: 100_000, reason: 'Levy overcharged' })
      .expect(201);
    const waiver = await stack.http
      .post(url(`/invoices/${invoice.id}/waivers`))
      .set(as(accountant))
      .send({ amount: 200_000, reason: 'Hardship' })
      .expect(201);
    expect(waiver.body.data.status).toBe('pending');
    await stack.http
      .post(url(`/invoices/${invoice.id}/waivers`))
      .set(as(accountant))
      .send({ amount: 3_200_000, reason: 'Too much with the pending one' })
      .expect(422);
    await stack.http
      .post(url(`/invoices/${invoice.id}/waivers/${waiver.body.data.id}/approve`))
      .set(as(manager))
      .send({})
      .expect(200);
    await stack.http
      .post(url(`/invoices/${invoice.id}/waivers/${waiver.body.data.id}/approve`))
      .set(as(manager))
      .send({})
      .expect(409);
    const detail = await stack.http
      .get(url(`/invoices/${invoice.id}`))
      .set(as(flatResident))
      .expect(200);
    expect(detail.body.data).toMatchObject({
      amountCredited: 100_000,
      amountWaived: 200_000,
      balance: 3_100_000,
    });
  });

  it('allocates a payment oldest first, holds the overpayment as credit, and is idempotent', async () => {
    const one = await stack.http
      .post(url('/invoices'))
      .set(as(accountant))
      .send({
        spaceId: flatId,
        description: 'Gate remote',
        dueDate: '2027-03-01',
        lines: [{ description: 'Remote', unitAmount: 1_500_000 }],
      })
      .expect(201);
    expect(one.body.data.number).toBe('INV-000003');
    await stack.http
      .post(url('/invoices'))
      .set(as(accountant))
      .send({
        spaceId: vacantId,
        description: 'Remote',
        dueDate: '2027-03-01',
        lines: [{ description: 'Remote', unitAmount: 100 }],
      })
      .expect(422);

    const invoices = stack.app.get(InvoicesService);
    const pay = () =>
      withTenant(stack.db.app, { estateId, userId: null }, (tx) =>
        invoices.allocate(tx, estateId, {
          payerUserId: flatResidentId,
          amount: 5_000_000,
          sourceType: 'payment',
          sourceId: 'txn-1',
          channel: 'paystack',
          postedBy: null,
        }),
      );
    const first = await pay();
    expect(first.allocations).toEqual([
      { invoiceId: expect.any(String), amount: 3_100_000 },
      { invoiceId: one.body.data.id, amount: 1_500_000 },
    ]);
    expect(first.remainder).toBe(400_000);
    const again = await pay();
    expect(again.duplicate).toBe(true);
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from tenant.allocations where source_id = 'txn-1'`,
      ),
    ).toBe(2);

    const mine = await stack.http
      .get(url('/invoices'))
      .query({ status: 'paid' })
      .set(as(flatResident))
      .expect(200);
    expect(mine.body.data).toHaveLength(2);
    const statement = await stack.http.get(url('/statements')).set(as(flatResident)).expect(200);
    expect(statement.body.data).toMatchObject({
      openingBalance: 0,
      closingBalance: 0,
      unallocatedCredit: 400_000,
    });
    expect(statement.body.data.lines.map((line: { type: string }) => line.type)).toEqual([
      'invoice',
      'credit_note',
      'waiver',
      'invoice',
      'payment',
      'payment',
    ]);
    await stack.http
      .get(url('/statements'))
      .query({ payerUserId: '0190f0d0-0000-7000-8000-000000000001' })
      .set(as(flatResident))
      .expect(403);
  });

  it('runs the daily job once: overdue, one late penalty per invoice, balanced ledger', async () => {
    const levy = await stack.http
      .post(url('/charges'))
      .set(as(accountant))
      .send({
        type: 'development_levy',
        name: 'Road levy',
        amountRule: { kind: 'fixed', amount: 1_000_000 },
        frequency: 'one_off',
        startsOn: '2026-01-01',
        penaltyRule: { kind: 'percent', basisPoints: 1_000 },
      })
      .expect(201);
    expect(levy.body.data.penaltyRule).toEqual({ kind: 'percent', basisPoints: 1_000 });
    const invoice = await stack.http
      .post(url('/invoices'))
      .set(as(accountant))
      .send({
        spaceId: houseId,
        description: 'Road levy',
        dueDate: '2027-02-01',
        lines: [{ description: 'Road levy', unitAmount: 1_000_000, chargeId: levy.body.data.id }],
      })
      .expect(201);
    const jobs = stack.app.get(BillingJobsService);
    const first = await jobs.runDaily(estateId, '2027-02-09');
    expect(first).toMatchObject({ penalties: 1, balanced: true });
    expect(first.overdue).toBeGreaterThanOrEqual(2);
    const again = await jobs.runDaily(estateId, '2027-02-10');
    expect(again).toMatchObject({ overdue: 0, penalties: 0, balanced: true });
    const list = await stack.http.get(url('/invoices')).set(as(houseResident)).expect(200);
    const penalty = list.body.data.find(
      (item: { penaltyForInvoiceId: string | null }) =>
        item.penaltyForInvoiceId === invoice.body.data.id,
    );
    expect(penalty).toMatchObject({ total: 100_000, status: 'issued' });
    const levyInvoice = list.body.data.find(
      (item: { id: string }) => item.id === invoice.body.data.id,
    );
    expect(levyInvoice.status).toBe('overdue');
  });

  it('keeps billing data inside its estate', async () => {
    const otherAccountant = await staff('+2348033000099', 'estate_accountant', otherEstateId);
    const theirs = await stack.http
      .get(`/v1/estates/${otherEstateId}/invoices`)
      .set(as(otherAccountant))
      .expect(200);
    expect(theirs.body.data).toEqual([]);
    await stack.http
      .get(url(`/billing-runs/${runId}`))
      .set(as(otherAccountant))
      .expect(404);
  });
});
