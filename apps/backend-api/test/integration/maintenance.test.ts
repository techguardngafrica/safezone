import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../../src/modules/maintenance/maintenance.service';
import { signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

describe('maintenance', () => {
  let stack: TestStack;
  let estateId: string;
  let manager: string;
  let technician: string;
  let technicianId: string;
  let resident: string;
  let neighbour: string;
  let unitId: string;
  let plumbingId: string;
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
    estateId = await stack.createEstate('Fix Estate');
    manager = (await staff('+2348037000001', 'estate_manager')).token;
    ({ token: technician, userId: technicianId } = await staff(
      '+2348037000002',
      'maintenance_officer',
    ));
    const admin = (await staff('+2348037000003', 'estate_administrator')).token;
    unitId = (
      await stack.http
        .post(url('/spaces'))
        .set(as(admin))
        .send({ type: 'unit', code: 'F-1' })
        .expect(201)
    ).body.data.id;
    const other = (
      await stack.http
        .post(url('/spaces'))
        .set(as(admin))
        .send({ type: 'unit', code: 'F-2' })
        .expect(201)
    ).body.data.id;
    for (const [spaceId, phone] of [
      [unitId, '+2348037000010'],
      [other, '+2348037000011'],
    ] as const) {
      await stack.http
        .post(url('/occupancies'))
        .set(as(manager))
        .send({ spaceId, type: 'tenant', head: { fullName: `Resident ${phone.slice(-2)}`, phone } })
        .expect(201);
    }
    resident = (await signIn(stack, '+2348037000010')).accessToken;
    neighbour = (await signIn(stack, '+2348037000011')).accessToken;
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  let requestId: string;

  it('seeds categories and lets a resident report a problem in their unit only', async () => {
    const categories = await stack.http
      .get(url('/maintenance-categories'))
      .set(as(resident))
      .expect(200);
    plumbingId = categories.body.data.find((c: { name: string }) => c.name === 'Plumbing').id;
    expect(categories.body.data.length).toBeGreaterThan(10);
    const otherUnit = (
      await stack.http.get(url('/units')).set(as(manager)).expect(200)
    ).body.data.find((u: { code: string }) => u.code === 'F-2').id;
    await stack.http
      .post(url('/maintenance-requests'))
      .set(as(resident))
      .send({
        categoryId: plumbingId,
        spaceId: otherUnit,
        title: 'Leak',
        description: 'Not my unit',
      })
      .expect(403);
    const created = await stack.http
      .post(url('/maintenance-requests'))
      .set(as(resident))
      .send({
        categoryId: plumbingId,
        spaceId: unitId,
        priority: 'urgent',
        title: 'Burst pipe',
        description: 'Water everywhere in the kitchen',
      })
      .expect(201);
    requestId = created.body.data.id;
    expect(created.body.data).toMatchObject({
      number: 'MR-000001',
      status: 'submitted',
      unitCode: 'F-1',
    });
    const due =
      new Date(created.body.data.slaDueAt).getTime() -
      new Date(created.body.data.createdAt).getTime();
    expect(due).toBe(4 * 3_600_000);
    await stack.http
      .get(url(`/maintenance-requests/${requestId}`))
      .set(as(neighbour))
      .expect(404);
  });

  it('hides neighbour complaints from other household members and internal notes from residents', async () => {
    const complaint = await stack.http
      .post(url('/maintenance-requests'))
      .set(as(neighbour))
      .send({
        kind: 'complaint',
        categoryId: plumbingId,
        title: 'Noise at night',
        description: 'F-1 generator runs all night',
        aboutNeighbour: true,
      })
      .expect(201);
    const forResident = await stack.http
      .get(url('/maintenance-requests'))
      .set(as(resident))
      .expect(200);
    expect(forResident.body.data.map((r: { id: string }) => r.id)).not.toContain(
      complaint.body.data.id,
    );
    await stack.http
      .post(url(`/maintenance-requests/${requestId}/comments`))
      .set(as(manager))
      .send({ body: 'Check stopcock first', internal: true })
      .expect(201);
    await stack.http
      .post(url(`/maintenance-requests/${requestId}/comments`))
      .set(as(resident))
      .send({ body: 'Secret', internal: true })
      .expect(403);
    const detail = await stack.http
      .get(url(`/maintenance-requests/${requestId}`))
      .set(as(resident))
      .expect(200);
    expect(detail.body.data.comments).toEqual([]);
  });

  it('pauses the SLA for information, then runs a work order to verified with a recharge invoice', async () => {
    await stack.http
      .post(url(`/maintenance-requests/${requestId}/approve`))
      .set(as(resident))
      .send({})
      .expect(403);
    await stack.http
      .post(url(`/maintenance-requests/${requestId}/request-info`))
      .set(as(manager))
      .send({ reason: 'Send a photo please' })
      .expect(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const answered = await stack.http
      .post(url(`/maintenance-requests/${requestId}/respond`))
      .set(as(resident))
      .send({ note: 'Photo attached' })
      .expect(200);
    const due =
      new Date(answered.body.data.slaDueAt).getTime() -
      new Date(answered.body.data.createdAt).getTime();
    expect(due).toBeGreaterThan(4 * 3_600_000);
    await stack.http
      .post(url(`/maintenance-requests/${requestId}/approve`))
      .set(as(manager))
      .send({})
      .expect(200);

    const order = await stack.http
      .post(url('/work-orders'))
      .set(as(manager))
      .send({
        requestId,
        title: 'Replace kitchen pipe',
        assignee: { type: 'staff', userId: technicianId },
      })
      .expect(201);
    expect(order.body.data).toMatchObject({ number: 'WO-000001', status: 'open', spaceId: unitId });
    const mine = await stack.http.get(url('/work-orders')).set(as(technician)).expect(200);
    expect(mine.body.data).toHaveLength(1);
    await stack.http
      .patch(url(`/work-orders/${order.body.data.id}`))
      .set(as(technician))
      .send({ labourCost: 1 })
      .expect(403);
    await stack.http
      .patch(url(`/work-orders/${order.body.data.id}`))
      .set(as(technician))
      .send({ status: 'completed' })
      .expect(409);
    await stack.http
      .patch(url(`/work-orders/${order.body.data.id}`))
      .set(as(technician))
      .send({ status: 'in_progress' })
      .expect(200);
    await stack.http
      .post(url(`/work-orders/${order.body.data.id}/materials`))
      .set(as(technician))
      .send({ item: 'PVC pipe 1m', quantity: 2, unitCost: 250_000 })
      .expect(201);
    await stack.http
      .patch(url(`/work-orders/${order.body.data.id}`))
      .set(as(manager))
      .send({ labourCost: 1_000_000, rechargeToResident: true })
      .expect(200);
    await stack.http
      .patch(url(`/work-orders/${order.body.data.id}`))
      .set(as(technician))
      .send({ status: 'completed', resolutionNotes: 'Pipe replaced' })
      .expect(200);
    const request = await stack.http
      .get(url(`/maintenance-requests/${requestId}`))
      .set(as(resident))
      .expect(200);
    expect(request.body.data.status).toBe('resolved');

    const verified = await stack.http
      .post(url(`/work-orders/${order.body.data.id}/verify`))
      .set(as(manager))
      .expect(200);
    expect(verified.body.data.status).toBe('verified');
    expect(verified.body.data.invoiceId).toEqual(expect.any(String));
    const invoice = await stack.http
      .get(url(`/invoices/${verified.body.data.invoiceId}`))
      .set(as(resident))
      .expect(200);
    expect(invoice.body.data).toMatchObject({ total: 1_500_000 });

    const rated = await stack.http
      .post(url(`/maintenance-requests/${requestId}/rate`))
      .set(as(resident))
      .send({ rating: 5, feedback: 'Fast' })
      .expect(200);
    expect(rated.body.data).toMatchObject({ status: 'closed', rating: 5 });
  });

  it('creates a contractor pass for a scheduled vendor visit to a unit', async () => {
    const start = new Date(Date.now() + 86_400_000);
    const end = new Date(start.getTime() + 3 * 3_600_000);
    const order = await stack.http
      .post(url('/work-orders'))
      .set(as(manager))
      .send({
        title: 'Fix AC',
        spaceId: unitId,
        assignee: { type: 'vendor', name: 'Cool Air Ltd', phone: '+2348037000099' },
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString(),
      })
      .expect(201);
    expect(order.body.data.status).toBe('scheduled');
    expect(order.body.data.visitorPassId).toEqual(expect.any(String));
  });

  it('escalates SLA breaches once per level and plans recurring work', async () => {
    const service = stack.app.get(MaintenanceService);
    const late = await stack.http
      .post(url('/maintenance-requests'))
      .set(as(resident))
      .send({
        categoryId: plumbingId,
        spaceId: unitId,
        priority: 'urgent',
        title: 'Sparking socket',
        description: 'Living room socket',
      })
      .expect(201);
    const due = new Date(late.body.data.slaDueAt);
    expect(await service.checkSla(estateId, new Date(due.getTime() + 60_000))).toBe(1);
    expect(await service.checkSla(estateId, new Date(due.getTime() + 120_000))).toBe(0);
    expect(await service.checkSla(estateId, new Date(due.getTime() + 3 * 3_600_000))).toBe(1);
    const detail = await stack.http
      .get(url(`/maintenance-requests/${late.body.data.id}`))
      .set(as(manager))
      .expect(200);
    expect(detail.body.data.slaBreached).toBe(true);

    await stack.http
      .post(url('/recurring-maintenance'))
      .set(as(manager))
      .send({ title: 'Generator service', frequency: 'monthly', startsOn: '2027-01-31' })
      .expect(201);
    expect((await service.daily(estateId, '2027-01-31')).planned).toBe(1);
    expect((await service.daily(estateId, '2027-02-01')).planned).toBe(0);
    const plans = await stack.http.get(url('/recurring-maintenance')).set(as(manager)).expect(200);
    expect(plans.body.data[0].nextRunOn).toBe('2027-02-28');
    const report = await stack.http
      .get(url('/reports/maintenance'))
      .query({ from: '2026-01-01', to: '2027-12-31' })
      .set(as(manager))
      .expect(200);
    expect(report.body.data).toMatchObject({ resolved: 1, averageRating: 5 });
    expect(report.body.data.costs).toMatchObject({
      labour: 1_000_000,
      materials: 500_000,
      recharged: 1_500_000,
    });
  });
});
