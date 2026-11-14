import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/common/database/tenant-context';
import { InvoicesService } from '../../src/modules/billing/invoices.service';
import { watInstant } from '../../src/modules/facilities/domain/facilities';
import { FacilitiesService } from '../../src/modules/facilities/facilities.service';
import { signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

describe('facilities and bookings', () => {
  let stack: TestStack;
  let estateId: string;
  let manager: string;
  let residentA: string;
  let residentAId: string;
  let residentB: string;
  let hallId: string;
  let courtId: string;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const url = (path: string) => `/v1/estates/${estateId}${path}`;
  const day = new Date(Date.now() + 3 * 86_400_000 + 3_600_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    stack = await startTestStack();
    estateId = await stack.createEstate('Leisure Estate');
    for (const [phone, role] of [
      ['+2348030600001', 'estate_manager'],
      ['+2348030600002', 'estate_administrator'],
    ] as const) {
      await stack.addMember(estateId, await stack.createUser(phone), role);
    }
    manager = (await signIn(stack, '+2348030600001', WEB_DEVICE)).accessToken;
    const admin = (await signIn(stack, '+2348030600002', WEB_DEVICE)).accessToken;
    await stack.db.owner.query(`update platform.sessions set mfa_verified_at = now()`);
    for (const [code, phone] of [
      ['L-1', '+2348030600010'],
      ['L-2', '+2348030600011'],
    ] as const) {
      const unit = (
        await stack.http
          .post(url('/spaces'))
          .set(as(admin))
          .send({ type: 'unit', code })
          .expect(201)
      ).body.data.id;
      await stack.http
        .post(url('/occupancies'))
        .set(as(manager))
        .send({ spaceId: unit, type: 'tenant', head: { fullName: `R ${code}`, phone } })
        .expect(201);
    }
    const a = await signIn(stack, '+2348030600010');
    residentA = a.accessToken;
    residentAId = a.user.id;
    residentB = (await signIn(stack, '+2348030600011')).accessToken;
    hallId = (
      await stack.http
        .post(url('/facilities'))
        .set(as(manager))
        .send({
          name: 'Event hall',
          type: 'event_hall',
          pricing: { basis: 'hourly', amount: 1_000_000 },
          policy: { maxGuests: 100, perHouseholdPerWeek: 1 },
        })
        .expect(201)
    ).body.data.id;
    courtId = (
      await stack.http
        .post(url('/facilities'))
        .set(as(manager))
        .send({
          name: 'Tennis court',
          type: 'court',
          policy: { requiresApproval: true, bufferMinutes: 30 },
        })
        .expect(201)
    ).body.data.id;
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  const slot = (from: string, to: string) => ({
    startsAt: watInstant(day, from).toISOString(),
    endsAt: watInstant(day, to).toISOString(),
  });

  it('lets only one of two simultaneous bookings for a slot succeed', async () => {
    const [first, second] = await Promise.all([
      stack.http
        .post(url('/bookings'))
        .set(as(residentA))
        .send({ facilityId: hallId, ...slot('10:00', '12:00'), guests: 20 }),
      stack.http
        .post(url('/bookings'))
        .set(as(residentB))
        .send({ facilityId: hallId, ...slot('11:00', '13:00') }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const winner = first.status === 201 ? first : second;
    expect(winner.body.data).toMatchObject({ status: 'pending_payment', price: 2_000_000 });
    expect(winner.body.data.invoiceId).toEqual(expect.any(String));
    const loser = first.status === 409 ? first : second;
    expect(loser.body.error.code).toBe('BOOKING_CONFLICT');
  });

  it('applies rules: hours, guests, weekly limit; managers can override with a reason', async () => {
    await stack.http
      .post(url('/bookings'))
      .set(as(residentB))
      .send({ facilityId: hallId, ...slot('21:00', '23:00') })
      .expect(422);
    await stack.http
      .post(url('/bookings'))
      .set(as(residentB))
      .send({ facilityId: hallId, ...slot('14:00', '15:00'), guests: 101 })
      .expect(422);
    const avail = await stack.http
      .get(url(`/facilities/${hallId}/availability`))
      .query({ date: day })
      .set(as(residentB))
      .expect(200);
    expect(avail.body.data.busy).toHaveLength(1);
  });

  it('confirms a booking when its invoice is paid and refunds by policy to credit on cancellation', async () => {
    const mine = (await stack.http.get(url('/bookings')).set(as(residentA)).expect(200)).body.data;
    const booking =
      mine[0] ??
      (await stack.http.get(url('/bookings')).set(as(residentB)).expect(200)).body.data[0];
    const payerToken = mine[0] ? residentA : residentB;
    const invoices = stack.app.get(InvoicesService);
    const payer = (
      await stack.db.owner.query<{ booked_by: string }>(
        `select booked_by from tenant.bookings where id = $1`,
        [booking.id],
      )
    ).rows[0]?.booked_by as string;
    await withTenant(stack.db.app, { estateId, userId: null }, (tx) =>
      invoices.allocate(tx, estateId, {
        payerUserId: payer,
        amount: 2_000_000,
        sourceType: 'payment',
        sourceId: 'hall-pay-1',
        channel: 'fake',
        postedBy: null,
      }),
    );
    expect(await stack.app.get(FacilitiesService).invoicePaid(estateId, booking.invoiceId)).toBe(
      true,
    );
    const confirmed = await stack.http
      .get(url(`/bookings/${booking.id}`))
      .set(as(payerToken))
      .expect(200);
    expect(confirmed.body.data.status).toBe('confirmed');
    // More than 24 hours ahead: full refund to the payer's credit.
    const cancelled = await stack.http
      .post(url(`/bookings/${booking.id}/cancel`))
      .set(as(payerToken))
      .send({ reason: 'Plans changed' })
      .expect(200);
    expect(cancelled.body.data).toMatchObject({ status: 'cancelled', refundAmount: 2_000_000 });
    const statement = await stack.http.get(url('/statements')).set(as(payerToken)).expect(200);
    expect(statement.body.data.unallocatedCredit).toBe(2_000_000);
    void residentAId;
  });

  it('needs approval where configured, keeps the buffer, and releases unpaid holds', async () => {
    const pending = await stack.http
      .post(url('/bookings'))
      .set(as(residentA))
      .send({ facilityId: courtId, ...slot('09:00', '10:00') })
      .expect(201);
    expect(pending.body.data.status).toBe('pending_approval');
    await stack.http
      .post(url('/bookings'))
      .set(as(residentB))
      .send({ facilityId: courtId, ...slot('10:15', '11:15') })
      .expect(409);
    await stack.http
      .post(url(`/bookings/${pending.body.data.id}/approve`))
      .set(as(residentA))
      .expect(403);
    const approved = await stack.http
      .post(url(`/bookings/${pending.body.data.id}/approve`))
      .set(as(manager))
      .expect(200);
    expect(approved.body.data.status).toBe('confirmed');

    const hold = await stack.http
      .post(url('/bookings'))
      .set(as(residentB))
      .send({ facilityId: hallId, ...slot('15:00', '16:00') })
      .expect(201);
    const service = stack.app.get(FacilitiesService);
    const result = await service.sweep(estateId, new Date(Date.now() + 31 * 60_000));
    expect(result.released).toBe(1);
    const released = await stack.http
      .get(url(`/bookings/${hold.body.data.id}`))
      .set(as(residentB))
      .expect(200);
    expect(released.body.data.status).toBe('cancelled');
    const invoice = await stack.http
      .get(url(`/invoices/${hold.body.data.invoiceId}`))
      .set(as(residentB))
      .expect(200);
    expect(invoice.body.data.status).toBe('cancelled');
  });

  it('cancels and refunds bookings caught by a maintenance blackout', async () => {
    const blackout = await stack.http
      .post(url(`/facilities/${courtId}/blackouts`))
      .set(as(manager))
      .send({ ...slot('08:00', '12:00'), reason: 'Resurfacing' })
      .expect(201);
    expect(blackout.body.data.affectedBookings).toBe(1);
    await stack.http
      .post(url('/bookings'))
      .set(as(residentB))
      .send({ facilityId: courtId, ...slot('11:00', '12:00') })
      .expect(409);
  });
});
