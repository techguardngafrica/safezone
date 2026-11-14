import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countRows, signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

describe('property: spaces tree', () => {
  let stack: TestStack;
  let estateId: string;
  let otherEstateId: string;
  let managerToken: string;
  let residentToken: string;
  let otherAdminToken: string;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const url = (path = '') => `/v1/estates/${estateId}${path}`;

  async function staff(estate: string, phone: string, role: string) {
    const id = await stack.createUser(phone);
    await stack.addMember(estate, id, role);
    const token = (await signIn(stack, phone, WEB_DEVICE)).accessToken;
    await stack.db.owner.query(
      `update platform.sessions set mfa_verified_at = now() where user_id = $1`,
      [id],
    );
    return token;
  }

  beforeAll(async () => {
    stack = await startTestStack();
    estateId = await stack.createEstate('Tree Estate');
    otherEstateId = await stack.createEstate('Other Estate');
    managerToken = await staff(estateId, '+2348037000001', 'estate_manager');
    otherAdminToken = await staff(otherEstateId, '+2348037000002', 'estate_administrator');
    const residentId = await stack.createUser('+2348037000003');
    await stack.addMember(estateId, residentId, 'tenant');
    residentToken = (await signIn(stack, '+2348037000003')).accessToken;
  });
  afterAll(async () => {
    await stack?.stop();
  });

  it('builds a tree, enforces placement and unique unit codes', async () => {
    const block = await stack.http
      .post(url('/spaces'))
      .set(as(managerToken))
      .send({ type: 'block', code: 'C', name: 'Block C' })
      .expect(201);
    const blockId: string = block.body.data.id;
    expect(block.body.data).toMatchObject({
      depth: 1,
      parentId: null,
      propertyId: null,
      status: null,
    });

    await stack.http
      .post(url('/spaces'))
      .set(as(managerToken))
      .send({ type: 'floor', code: '1' })
      .expect(422);
    await stack.http
      .post(url('/spaces'))
      .set(as(managerToken))
      .send({ type: 'block', code: 'D', bedrooms: 2 })
      .expect(422);

    const unit = await stack.http
      .post(url('/spaces'))
      .set(as(managerToken))
      .send({ parentId: blockId, type: 'unit', code: 'C-G-1', unitType: 'flat', bedrooms: 3 })
      .expect(201);
    expect(unit.body.data).toMatchObject({ depth: 2, status: 'vacant', bedrooms: 3 });
    expect(unit.body.data.propertyId).toMatch(/-C-G-1$/);

    await stack.http
      .post(url('/spaces'))
      .set(as(managerToken))
      .send({ parentId: unit.body.data.id, type: 'unit', code: 'X' })
      .expect(422);
    const dup = await stack.http
      .post(url('/spaces'))
      .set(as(managerToken))
      .send({ type: 'unit', code: 'c-g-1' })
      .expect(409);
    expect(dup.body.error.code).toBe('SPACE_CODE_TAKEN');

    // Residents can browse but not change the tree.
    await stack.http.get(url('/spaces')).set(as(residentToken)).expect(200);
    await stack.http
      .post(url('/spaces'))
      .set(as(residentToken))
      .send({ type: 'block', code: 'R' })
      .expect(403);
    // Another estate's administrator sees nothing.
    await stack.http.get(url('/spaces')).set(as(otherAdminToken)).expect(404);
    await stack.http
      .get(`/v1/estates/${otherEstateId}/spaces/${blockId}`)
      .set(as(otherAdminToken))
      .expect(404);
  });

  it('bulk-creates floors and flats, previews first, and finds units by subtree', async () => {
    const block = await stack.http
      .post(url('/spaces'))
      .set(as(managerToken))
      .send({ type: 'block', code: 'E', name: 'Block E' })
      .expect(201);
    const body = {
      parentId: block.body.data.id,
      levels: [
        { type: 'floor', labels: { from: 1, to: 5 } },
        { type: 'unit', labels: { letters: { from: 'A', to: 'D' } } },
      ],
    };
    const preview = await stack.http
      .post(url('/spaces/bulk'))
      .set(as(managerToken))
      .send({ ...body, dryRun: true })
      .expect(200);
    expect(preview.body.data).toMatchObject({
      dryRun: true,
      total: 25,
      byType: { floor: 5, unit: 20 },
    });
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from tenant.spaces where estate_id = $1 and parent_id = $2`,
        [estateId, block.body.data.id],
      ),
    ).toBe(0);

    await stack.http.post(url('/spaces/bulk')).set(as(managerToken)).send(body).expect(200);
    const units = await stack.http
      .get(url('/units'))
      .query({ withinId: block.body.data.id, limit: 50 })
      .set(as(managerToken))
      .expect(200);
    expect(units.body.data).toHaveLength(20);
    expect(units.body.data[0].code).toBe('E-1-A');

    // Paging through units returns each once.
    const first = await stack.http
      .get(url('/units'))
      .query({ withinId: block.body.data.id, limit: 15 })
      .set(as(managerToken))
      .expect(200);
    const second = await stack.http
      .get(url('/units'))
      .query({ withinId: block.body.data.id, limit: 15, cursor: first.body.meta.nextCursor })
      .set(as(managerToken))
      .expect(200);
    expect(second.body.meta.nextCursor).toBeNull();
    expect(
      new Set([...first.body.data, ...second.body.data].map((space: { id: string }) => space.id))
        .size,
    ).toBe(20);

    // Running the same pattern again clashes on unit codes, and nothing is created.
    const again = await stack.http
      .post(url('/spaces/bulk'))
      .set(as(managerToken))
      .send(body)
      .expect(409);
    expect(again.body.error.code).toBe('SPACE_CODE_TAKEN');

    const search = await stack.http
      .get(url('/units'))
      .query({ q: 'e-3' })
      .set(as(managerToken))
      .expect(200);
    expect(search.body.data.map((space: { code: string }) => space.code)).toEqual([
      'E-3-A',
      'E-3-B',
      'E-3-C',
      'E-3-D',
    ]);
  });

  it('re-parents a subtree, refuses cycles and stale versions, archives leaves only', async () => {
    const zone = await stack.http
      .post(url('/spaces'))
      .set(as(managerToken))
      .send({ type: 'zone', code: 'North' })
      .expect(201);
    const block = await stack.http
      .post(url('/spaces'))
      .set(as(managerToken))
      .send({ type: 'block', code: 'F' })
      .expect(201);
    await stack.http
      .post(url('/spaces/bulk'))
      .set(as(managerToken))
      .send({
        parentId: block.body.data.id,
        levels: [
          { type: 'floor', labels: { from: 1, to: 2 } },
          { type: 'unit', labels: { list: ['A'] } },
        ],
      })
      .expect(200);

    const moved = await stack.http
      .patch(url(`/spaces/${block.body.data.id}`))
      .set(as(managerToken))
      .set('If-Match', String(block.body.data.version))
      .send({ parentId: zone.body.data.id })
      .expect(200);
    expect(moved.body.data).toMatchObject({ parentId: zone.body.data.id, depth: 2 });
    const inZone = await stack.http
      .get(url('/units'))
      .query({ withinId: zone.body.data.id })
      .set(as(managerToken))
      .expect(200);
    expect(
      inZone.body.data.map((space: { code: string; depth: number }) => [space.code, space.depth]),
    ).toEqual([
      ['F-1-A', 4],
      ['F-2-A', 4],
    ]);

    // Stale If-Match, a move inside itself, and a zone inside its own block are refused.
    await stack.http
      .patch(url(`/spaces/${block.body.data.id}`))
      .set(as(managerToken))
      .set('If-Match', String(block.body.data.version))
      .send({ name: 'Block F' })
      .expect(409);
    const floors = await stack.http
      .get(url('/spaces'))
      .query({ parentId: block.body.data.id })
      .set(as(managerToken))
      .expect(200);
    const floorId: string = floors.body.data[0].id;
    await stack.http
      .patch(url(`/spaces/${zone.body.data.id}`))
      .set(as(managerToken))
      .send({ parentId: floorId })
      .expect(422);

    // Archive: not while it has children.
    const archiveBlock = await stack.http
      .post(url(`/spaces/${block.body.data.id}/archive`))
      .set(as(managerToken))
      .expect(409);
    expect(archiveBlock.body.error.code).toBe('SPACE_HAS_CHILDREN');
    const unitsOnFloor = await stack.http
      .get(url('/spaces'))
      .query({ parentId: floorId })
      .set(as(managerToken))
      .expect(200);
    const archived = await stack.http
      .post(url(`/spaces/${unitsOnFloor.body.data[0].id}/archive`))
      .set(as(managerToken))
      .expect(200);
    expect(archived.body.data.archivedAt).toEqual(expect.any(String));
    // An archived unit's code can be reused.
    await stack.http
      .post(url('/spaces'))
      .set(as(managerToken))
      .send({ parentId: floorId, type: 'unit', code: unitsOnFloor.body.data[0].code })
      .expect(201);
  });

  it('feeds the setup wizard: the spaces step needs a unit', async () => {
    const fresh = await stack.createEstate('Empty Estate');
    await stack.db.owner.query(`update platform.estates set status = 'approved' where id = $1`, [
      fresh,
    ]);
    const token = await staff(fresh, '+2348037000010', 'estate_administrator');
    const step = `/v1/estates/${fresh}/setup-progress/spaces/complete`;
    const empty = await stack.http.post(step).set(as(token)).expect(422);
    expect(empty.body.error.code).toBe('SETUP_STEP_INCOMPLETE');
    await stack.http
      .post(`/v1/estates/${fresh}/spaces`)
      .set(as(token))
      .send({ type: 'unit', code: 'H1', unitType: 'house' })
      .expect(201);
    await stack.http.post(step).set(as(token)).expect(200);
  });
});
