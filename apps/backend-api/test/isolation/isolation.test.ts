import { ModulesContainer } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectRoutes, type RouteInfo } from '../../src/common/contract/route-catalogue';
import { uuidv7 } from '../../src/common/ids/uuidv7';
import { signIn, startTestStack, type TestStack } from '../integration/support/app';

/**
 * Cross-tenant isolation suite (AGENTS.md §5.2, backend-api.md §8). Routes are discovered from the
 * running app, so every new endpoint is covered automatically:
 * - every route declares access (@Public/@SignedIn/@Member/@Can) and a @Contract;
 * - every non-public route rejects anonymous callers;
 * - every estate route rejects a fully privileged user from another estate with 403/404;
 * - resources of Estate A are invisible through Estate B's routes (RLS).
 */
describe('cross-tenant isolation', () => {
  let stack: TestStack;
  let routes: RouteInfo[];
  let estateA: string;
  let estateB: string;
  let adminA: string;
  let adminB: string;

  async function privilegedAdmin(phone: string, estateId: string): Promise<string> {
    const userId = await stack.createUser(phone);
    await stack.addMember(estateId, userId, 'estate_administrator');
    await stack.addMember(estateId, userId, 'security_supervisor');
    await stack.resetRateLimits();
    const session = await signIn(stack, phone);
    await stack.db.owner.query(
      `update platform.sessions set mfa_verified_at = now() where user_id = $1`,
      [userId],
    );
    return session.accessToken;
  }

  beforeAll(async () => {
    stack = await startTestStack();
    routes = collectRoutes(stack.app.get(ModulesContainer));
    estateA = await stack.createEstate('Estate A');
    estateB = await stack.createEstate('Estate B');
    adminA = await privilegedAdmin('+2348036000001', estateA);
    adminB = await privilegedAdmin('+2348036000002', estateB);
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  function call(route: RouteInfo, params: Record<string, string>) {
    const url = route.expressPath.replace(
      /:(\w+)/g,
      (_match, name: string) => params[name] ?? uuidv7(),
    );
    return stack.http[route.method](url);
  }

  it('discovers the API routes', () => {
    expect(routes.length).toBeGreaterThan(30);
    expect(
      routes.filter((route) => route.expressPath.includes(':estateId')).length,
    ).toBeGreaterThan(5);
  });

  it('every route declares its access rule and a contract', () => {
    const undeclared = routes
      .filter((route) => !route.access)
      .map((r) => `${r.method} ${r.expressPath}`);
    const noContract = routes
      .filter((route) => !route.contract)
      .map((r) => `${r.method} ${r.expressPath}`);
    expect(undeclared).toEqual([]);
    expect(noContract).toEqual([]);
  });

  it('estate routes are never public', () => {
    const exposed = routes
      .filter((route) => route.expressPath.includes(':estateId') && route.access?.kind === 'public')
      .map((r) => `${r.method} ${r.expressPath}`);
    expect(exposed).toEqual([]);
  });

  it('every non-public route rejects anonymous callers with 401', async () => {
    const failures: string[] = [];
    for (const route of routes.filter((r) => r.access?.kind !== 'public')) {
      const response = await call(route, { estateId: estateA }).send({});
      if (response.status !== 401)
        failures.push(`${route.method} ${route.expressPath} → ${response.status}`);
    }
    expect(failures).toEqual([]);
  });

  it("every estate route refuses Estate B's administrator on Estate A (403/404)", async () => {
    const failures: string[] = [];
    for (const route of routes.filter((r) => r.expressPath.includes(':estateId'))) {
      const response = await call(route, { estateId: estateA })
        .set('Authorization', `Bearer ${adminB}`)
        .send({});
      if (response.status !== 403 && response.status !== 404) {
        failures.push(`${route.method} ${route.expressPath} → ${response.status}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("Estate A's records cannot be reached through Estate B's routes", async () => {
    // A file created in Estate A.
    const ticket = await stack.http
      .post(`/v1/estates/${estateA}/files/upload-url`)
      .set('Authorization', `Bearer ${adminA}`)
      .send({ purpose: 'document', mimeType: 'application/pdf', sizeBytes: 1000 })
      .expect(200);
    const fileId = ticket.body.data.fileId as string;
    await stack.http
      .get(`/v1/estates/${estateA}/files/${fileId}`)
      .set('Authorization', `Bearer ${adminA}`)
      .expect(200);
    for (const suffix of ['', '/download-url']) {
      await stack.http
        .get(`/v1/estates/${estateB}/files/${fileId}${suffix}`)
        .set('Authorization', `Bearer ${adminB}`)
        .expect(404);
    }
    await stack.http
      .post(`/v1/estates/${estateB}/files/${fileId}/complete`)
      .set('Authorization', `Bearer ${adminB}`)
      .expect(404);

    // Settings changed in A do not leak into B.
    await stack.http
      .patch(`/v1/estates/${estateA}/settings`)
      .set('Authorization', `Bearer ${adminA}`)
      .send({ 'visitor.max_pass_days': 3 })
      .expect(200);
    const bSettings = await stack.http
      .get(`/v1/estates/${estateB}/settings`)
      .set('Authorization', `Bearer ${adminB}`)
      .expect(200);
    expect(bSettings.body.data['visitor.max_pass_days']).toBe(30);

    // Estate profile: B's admin only ever sees B.
    const profile = await stack.http
      .get(`/v1/estates/${estateB}`)
      .set('Authorization', `Bearer ${adminB}`)
      .expect(200);
    expect(profile.body.data.id).toBe(estateB);
  });

  it("Estate A's incidents cannot be read or changed through Estate B", async () => {
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
    const incident = await stack.http
      .post(`/v1/estates/${estateA}/incidents`)
      .set(auth(adminA))
      .send({
        category: 'theft',
        severity: 'high',
        title: 'Bike stolen',
        description: 'Taken from the rack by block A',
        locationKind: 'other',
        locationText: 'Bike rack',
        occurredAt: new Date(Date.now() - 60_000).toISOString(),
      })
      .expect(201);
    const id = incident.body.data.id as string;
    // B's administrator manages incidents in B, but A's incident does not exist there.
    await stack.http.get(`/v1/estates/${estateB}/incidents/${id}`).set(auth(adminB)).expect(404);
    await stack.http
      .post(`/v1/estates/${estateB}/incidents/${id}/transition`)
      .set(auth(adminB))
      .send({ action: 'review', version: 1 })
      .expect(404);
    await stack.http
      .post(`/v1/estates/${estateB}/incidents/${id}/notes`)
      .set(auth(adminB))
      .send({ body: 'Not mine' })
      .expect(404);
    const listB = await stack.http
      .get(`/v1/estates/${estateB}/incidents`)
      .set(auth(adminB))
      .expect(200);
    expect(listB.body.data.map((item: { id: string }) => item.id)).not.toContain(id);
  });

  it('a permission snapshot for a foreign estate is empty', async () => {
    const snapshot = await stack.http
      .get('/v1/me/permissions')
      .query({ estateId: estateA })
      .set('Authorization', `Bearer ${adminB}`)
      .expect(200);
    expect(snapshot.body.data).toMatchObject({ roles: [], permissions: [] });
  });
});
