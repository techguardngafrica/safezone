import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countRows, signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

describe('utilities', () => {
  let stack: TestStack;
  let estateId: string;
  let admin: string;
  let accountant: string;
  let manager: string;
  let resident: string;
  let blockId: string;
  let unitA: string;
  let unitB: string;
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
    return token;
  }

  beforeAll(async () => {
    stack = await startTestStack();
    estateId = await stack.createEstate('Power Estate');
    admin = await staff('+2348038000001', 'estate_administrator');
    accountant = await staff('+2348038000002', 'estate_accountant');
    manager = await staff('+2348038000003', 'estate_manager');
    blockId = (
      await stack.http
        .post(url('/spaces'))
        .set(as(admin))
        .send({ type: 'block', code: 'G' })
        .expect(201)
    ).body.data.id;
    unitA = (
      await stack.http
        .post(url('/spaces'))
        .set(as(admin))
        .send({ parentId: blockId, type: 'unit', code: 'G-1' })
        .expect(201)
    ).body.data.id;
    unitB = (
      await stack.http
        .post(url('/spaces'))
        .set(as(admin))
        .send({ type: 'unit', code: 'H-1' })
        .expect(201)
    ).body.data.id;
    for (const [spaceId, phone] of [
      [unitA, '+2348038000010'],
      [unitB, '+2348038000011'],
    ] as const) {
      await stack.http
        .post(url('/occupancies'))
        .set(as(manager))
        .send({ spaceId, type: 'tenant', head: { fullName: `R ${phone.slice(-2)}`, phone } })
        .expect(201);
    }
    resident = (await signIn(stack, '+2348038000010')).accessToken;
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('validates public meters with the provider and keeps sub-meters for management', async () => {
    await stack.http
      .post(url('/meters/lookup'))
      .set(as(resident))
      .send({ providerCode: 'IKEDC', meterNumber: '00001234567' })
      .expect(422);
    const lookup = await stack.http
      .post(url('/meters/lookup'))
      .set(as(resident))
      .send({ providerCode: 'IKEDC', meterNumber: '45001234568' })
      .expect(200);
    expect(lookup.body.data).toMatchObject({
      prepaid: true,
      accountName: expect.stringContaining('4568'),
    });
    await stack.http
      .post(url('/meters'))
      .set(as(resident))
      .send({
        spaceId: unitB,
        type: 'electricity',
        providerCode: 'IKEDC',
        meterNumber: '45001234568',
      })
      .expect(403);
    const meter = await stack.http
      .post(url('/meters'))
      .set(as(resident))
      .send({
        spaceId: unitA,
        type: 'electricity',
        providerCode: 'IKEDC',
        meterNumber: '45001234568',
      })
      .expect(201);
    expect(meter.body.data.verifiedAt).toEqual(expect.any(String));
    await stack.http
      .post(url('/meters'))
      .set(as(resident))
      .send({
        spaceId: unitA,
        type: 'electricity',
        supply: 'estate',
        providerCode: 'ESTATE',
        meterNumber: 'SUB-0001',
      })
      .expect(403);
  });

  it('bills estate-run electricity from readings through an approved billing run', async () => {
    const subA = (
      await stack.http
        .post(url('/meters'))
        .set(as(admin))
        .send({
          spaceId: unitA,
          type: 'electricity',
          supply: 'estate',
          providerCode: 'ESTATE',
          meterNumber: 'SUB-0001',
        })
        .expect(201)
    ).body.data.id;
    const subB = (
      await stack.http
        .post(url('/meters'))
        .set(as(admin))
        .send({
          spaceId: unitB,
          type: 'electricity',
          supply: 'estate',
          providerCode: 'ESTATE',
          meterNumber: 'SUB-0002',
        })
        .expect(201)
    ).body.data.id;
    const readings = await stack.http
      .post(url('/meter-readings'))
      .set(as(accountant))
      .send({
        readings: [
          { meterId: subA, reading: 1000, readAt: '2026-09-30T18:00:00+01:00' },
          { meterId: subA, reading: 1150.5, readAt: '2026-10-31T18:00:00+01:00' },
          { meterId: subB, reading: 500, readAt: '2026-10-31T18:00:00+01:00' },
          { meterId: subB, reading: 400, readAt: '2026-11-01T18:00:00+01:00' },
        ],
      })
      .expect(201);
    expect(readings.body.data).toEqual({
      recorded: 3,
      rejected: [{ meterId: subB, reason: 'lower_than_previous' }],
    });
    await stack.http
      .post(url('/meter-readings'))
      .set(as(resident))
      .send({ readings: [{ meterId: subA, reading: 2000, readAt: '2026-11-01T10:00:00+01:00' }] })
      .expect(403);

    const charge = await stack.http
      .post(url('/charges'))
      .set(as(accountant))
      .send({
        type: 'utility_charge',
        name: 'Estate power',
        amountRule: {
          kind: 'metered',
          utility: 'electricity',
          ratePerUnit: 20_000,
          fixedAmount: 100_000,
        },
        frequency: 'monthly',
        startsOn: '2026-01-01',
      })
      .expect(201);
    const run = await stack.http
      .post(url('/billing-runs'))
      .set(as(accountant))
      .send({
        label: 'October power',
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        dueDate: '2026-11-30',
        chargeIds: [charge.body.data.id],
      })
      .expect(201);
    const preview = await stack.http
      .post(url(`/billing-runs/${run.body.data.id}/preview`))
      .set(as(accountant))
      .expect(200);
    // G-1 used 150.5 kWh: 150.5 × ₦200 + ₦1,000. H-1 has a single reading, so it is not billed on a guess.
    expect(preview.body.data.totals).toEqual({
      invoices: 1,
      amount: 3_010_000 + 100_000,
      skippedUnits: 1,
    });
    const items = await stack.http
      .get(url(`/billing-runs/${run.body.data.id}/items`))
      .set(as(accountant))
      .expect(200);
    expect(items.body.data[0].lines[0].description).toBe('Estate power (150.5 kWh)');
  });

  it('announces outages only to residents of affected spaces', async () => {
    await stack.http
      .post(url('/utility-outages'))
      .set(as(resident))
      .send({ type: 'water', title: 'Water off', startsAt: '2026-12-01T09:00:00+01:00' })
      .expect(403);
    const outage = await stack.http
      .post(url('/utility-outages'))
      .set(as(manager))
      .send({
        type: 'water',
        title: 'Block G water off',
        startsAt: '2026-12-01T09:00:00+01:00',
        expectedEndAt: '2026-12-01T13:00:00+01:00',
        spaceIds: [blockId],
      })
      .expect(201);
    expect(outage.body.data.notified).toBe(1);
    const mine = await stack.http.get(url('/utility-outages')).set(as(resident)).expect(200);
    expect(mine.body.data).toHaveLength(1);
    const other = (await signIn(stack, '+2348038000011')).accessToken;
    const theirs = await stack.http.get(url('/utility-outages')).set(as(other)).expect(200);
    expect(theirs.body.data).toHaveLength(0);
    await stack.http
      .patch(url(`/utility-outages/${outage.body.data.id}`))
      .set(as(manager))
      .send({ status: 'resolved' })
      .expect(200);
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.outbox_events where type = 'utilities.outage.resolved'`,
      ),
    ).toBe(1);
  });
});
