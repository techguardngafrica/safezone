import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countRows, signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

describe('official announcements', () => {
  let stack: TestStack;
  let estateId: string;
  let managerToken: string;
  let blockResident: string;
  let houseResident: string;
  let blockId: string;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const url = (path: string) => `/v1/estates/${estateId}${path}`;

  beforeAll(async () => {
    stack = await startTestStack();
    estateId = await stack.createEstate('News Estate');
    const managerId = await stack.createUser('+2348032000001');
    await stack.addMember(estateId, managerId, 'estate_manager');
    managerToken = (await signIn(stack, '+2348032000001', WEB_DEVICE)).accessToken;
    await stack.db.owner.query(
      `update platform.sessions set mfa_verified_at = now() where user_id = $1`,
      [managerId],
    );

    blockId = (
      await stack.http
        .post(url('/spaces'))
        .set(as(managerToken))
        .send({ type: 'block', code: 'A' })
        .expect(201)
    ).body.data.id;
    const flat = await stack.http
      .post(url('/spaces'))
      .set(as(managerToken))
      .send({ parentId: blockId, type: 'unit', code: 'A-1' })
      .expect(201);
    const house = await stack.http
      .post(url('/spaces'))
      .set(as(managerToken))
      .send({ type: 'unit', code: 'H9' })
      .expect(201);
    for (const [spaceId, phone] of [
      [flat.body.data.id, '+2348032000010'],
      [house.body.data.id, '+2348032000011'],
    ]) {
      await stack.http
        .post(url('/occupancies'))
        .set(as(managerToken))
        .send({ spaceId, type: 'tenant', head: { fullName: `Resident ${phone.slice(-2)}`, phone } })
        .expect(201);
    }
    blockResident = (await signIn(stack, '+2348032000010')).accessToken;
    houseResident = (await signIn(stack, '+2348032000011')).accessToken;
  });
  afterAll(async () => {
    await stack?.stop();
  });

  it('targets the estate or a block, filters what residents see and tracks reads', async () => {
    await stack.http
      .post(url('/announcements'))
      .set(as(blockResident))
      .send({ title: 'Hello', body: 'Not official', audience: { type: 'estate' } })
      .expect(403);
    const estateWide = await stack.http
      .post(url('/announcements'))
      .set(as(managerToken))
      .send({
        title: 'Gate hours',
        body: 'The back gate closes at 10pm from Monday.',
        audience: { type: 'estate' },
      })
      .expect(201);
    expect(estateWide.body.data).toMatchObject({ official: true, recipients: 3 });
    const blockOnly = await stack.http
      .post(url('/announcements'))
      .set(as(managerToken))
      .send({
        title: 'Water off',
        body: 'Block A water off 9am to 1pm.',
        priority: 'important',
        audience: { type: 'spaces', spaceIds: [blockId] },
      })
      .expect(201);
    expect(blockOnly.body.data.recipients).toBe(1);

    const forBlock = await stack.http.get(url('/announcements')).set(as(blockResident)).expect(200);
    expect(forBlock.body.data.map((item: { title: string }) => item.title)).toEqual([
      'Water off',
      'Gate hours',
    ]);
    const forHouse = await stack.http.get(url('/announcements')).set(as(houseResident)).expect(200);
    expect(forHouse.body.data.map((item: { title: string }) => item.title)).toEqual(['Gate hours']);
    await stack.http
      .post(url(`/announcements/${blockOnly.body.data.id}/read`))
      .set(as(houseResident))
      .expect(404);

    const read = await stack.http
      .post(url(`/announcements/${blockOnly.body.data.id}/read`))
      .set(as(blockResident))
      .expect(200);
    expect(read.body.data.read).toBe(true);
    const all = await stack.http
      .get(url('/announcements'))
      .query({ all: true })
      .set(as(managerToken))
      .expect(200);
    expect(all.body.data[0]).toMatchObject({ title: 'Water off', recipients: 1, read: null });
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.outbox_events where payload->>'dedupeKey' = $1`,
        [`announcement:${blockOnly.body.data.id}`],
      ),
    ).toBe(1);
  });
});
