import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImportRunner } from '../../src/modules/imports/import-runner.service';
import { countRows, signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

/**
 * Bulk import (management-web.md §6.4, tenancy.md §7.8): dry run, race-safe confirm, execution through the
 * owning modules, idempotent re-imports, kind permissions and run-time permission re-checks.
 */
describe('bulk imports', () => {
  let stack: TestStack;
  let estateId: string;
  let admin: string;
  let adminId: string;
  let financeAdmin: string;
  let resident: string;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const url = (path: string) => `/v1/estates/${estateId}${path}`;

  async function staff(phone: string, roles: string[]) {
    const userId = await stack.createUser(phone);
    for (const role of roles) await stack.addMember(estateId, userId, role);
    await stack.resetRateLimits();
    const token = (await signIn(stack, phone, WEB_DEVICE)).accessToken;
    await stack.db.owner.query(
      `update platform.sessions set mfa_verified_at = now() where user_id = $1`,
      [userId],
    );
    return { token, userId };
  }

  function futureDate(days: number): string {
    return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  }

  function dryRun(token: string, kind: string, csv: string) {
    return stack.http
      .post(url('/imports/dry-run'))
      .set(as(token))
      .send({ kind, filename: `${kind}.csv`, csv });
  }

  /** Dry run, confirm and run the worker step; returns the finished job. */
  async function importFile(token: string, kind: string, csv: string) {
    const job = (await dryRun(token, kind, csv).expect(201)).body.data as { id: string };
    await stack.http
      .post(url(`/imports/${job.id}/confirm`))
      .set(as(token))
      .expect(200);
    await stack.app.get(ImportRunner).run(estateId, job.id);
    return (
      await stack.http
        .get(url(`/imports/${job.id}`))
        .set(as(token))
        .expect(200)
    ).body.data;
  }

  beforeAll(async () => {
    stack = await startTestStack();
    estateId = await stack.createEstate('Import Estate');
    ({ token: admin, userId: adminId } = await staff('+2348037100001', ['estate_administrator']));
    ({ token: financeAdmin } = await staff('+2348037100002', [
      'estate_administrator',
      'estate_accountant',
    ]));
    const residentId = await stack.createUser('+2348037100003');
    await stack.addMember(estateId, residentId, 'tenant');
    await stack.resetRateLimits();
    resident = (await signIn(stack, '+2348037100003')).accessToken;
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  const unitsCsv =
    'code,name,unit_type,bedrooms,unit_status\n' +
    'A-101,Flat 101,flat,3,vacant\n' +
    'A-102,Flat 102,flat,2,\n' +
    'A-103,Flat 103,house,,reserved\n' +
    ',Missing code,flat,1,vacant\n';

  it('refuses residents and users without the kind permission', async () => {
    await dryRun(resident, 'units', unitsCsv).expect(403);
    const balances = await dryRun(
      admin,
      'opening_balances',
      `unit_code,external_ref,amount_naira,description,due_date\nA-101,OB-1,100,Opening,${futureDate(30)}\n`,
    ).expect(403);
    expect(balances.body.error.code).toBe('IMPORT_KIND_FORBIDDEN');
  });

  it('rejects a file without the template columns', async () => {
    const response = await dryRun(
      admin,
      'owners',
      'unit_code,phone\nA-101,+2348012345678\n',
    ).expect(422);
    expect(response.body.error.code).toBe('IMPORT_HEADERS_MISSING');
  });

  it('dry-runs, confirms exactly once and creates units through the property module', async () => {
    const dry = (await dryRun(admin, 'units', unitsCsv).expect(201)).body.data;
    expect(dry).toMatchObject({ status: 'dry_run', totalRows: 4, validRows: 3, errorRows: 1 });
    expect(dry.errors).toEqual([expect.objectContaining({ row: 5, field: 'code' })]);

    const [first, second] = await Promise.all([
      stack.http.post(url(`/imports/${dry.id}/confirm`)).set(as(admin)),
      stack.http.post(url(`/imports/${dry.id}/confirm`)).set(as(admin)),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);

    await stack.app.get(ImportRunner).run(estateId, dry.id);
    // A duplicate delivery of the same job does nothing.
    await stack.app.get(ImportRunner).run(estateId, dry.id);
    const done = (
      await stack.http
        .get(url(`/imports/${dry.id}`))
        .set(as(admin))
        .expect(200)
    ).body.data;
    expect(done).toMatchObject({
      status: 'completed',
      createdCount: 3,
      updatedCount: 0,
      unchangedCount: 0,
      failedCount: 0,
    });
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from tenant.spaces where estate_id = $1 and type = 'unit'`,
        [estateId],
      ),
    ).toBe(3);
    // Validated rows (personal data in other kinds) are not kept after the run.
    const payload = await stack.db.owner.query<{ payload_json: unknown }>(
      `select payload_json from tenant.bulk_import_jobs where id = $1`,
      [dry.id],
    );
    expect(payload.rows[0]?.payload_json).toEqual([]);
  });

  it('re-importing the same file updates instead of duplicating', async () => {
    const again = await importFile(admin, 'units', unitsCsv);
    expect(again).toMatchObject({ createdCount: 0, updatedCount: 0, unchangedCount: 3 });
    const renamed = await importFile(admin, 'units', 'code,name\na-101,Flat One-O-One\n');
    expect(renamed).toMatchObject({ createdCount: 0, updatedCount: 1 });
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from tenant.spaces where estate_id = $1 and type = 'unit'`,
        [estateId],
      ),
    ).toBe(3);
  });

  it('imports residents, households and vehicles through occupancy', async () => {
    const residents = await importFile(
      admin,
      'residents',
      'unit_code,full_name,phone,occupancy_type\n' +
        'A-101,Chidi Nwachukwu,+2348037100011,tenant\n' +
        'A-101,Ngozi Nwachukwu,+2348037100012,tenant\n' +
        'Z-999,Nobody Here,+2348037100013,tenant\n',
    );
    expect(residents).toMatchObject({ createdCount: 2, failedCount: 1 });
    expect(residents.errors).toEqual([
      expect.objectContaining({ row: 4, message: 'Unit Z-999 not found' }),
    ]);
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from tenant.household_members m join tenant.households h on h.id = m.household_id
          where h.estate_id = $1 and h.status = 'active'`,
        [estateId],
      ),
    ).toBe(2);

    const rerun = await importFile(
      admin,
      'residents',
      'unit_code,full_name,phone\nA-101,Chidi Nwachukwu,+2348037100011\n',
    );
    expect(rerun).toMatchObject({ createdCount: 0, unchangedCount: 1 });

    const households = await importFile(
      admin,
      'households',
      'unit_code,household_name,head_name,head_phone\n' +
        'A-101,Nwachukwu Family,Chidi Nwachukwu,+2348037100011\n' +
        'A-102,Bello Family,Musa Bello,+2348037100014\n',
    );
    expect(households).toMatchObject({ createdCount: 1, updatedCount: 1, failedCount: 0 });

    const vehicles = await importFile(
      admin,
      'vehicles',
      'unit_code,plate,make,model,colour\n' +
        'A-101,LSR-421-AA,Toyota,Corolla,Silver\n' +
        'A-103,KJA-100-BB,Honda,Civic,Black\n',
    );
    expect(vehicles).toMatchObject({ createdCount: 1, failedCount: 1 });
    const recolour = await importFile(
      admin,
      'vehicles',
      'unit_code,plate,colour\nA-101,lsr 421 aa,Blue\n',
    );
    expect(recolour).toMatchObject({ createdCount: 0, updatedCount: 1 });
  });

  it('imports opening balances in kobo once per reference', async () => {
    const csv =
      'unit_code,external_ref,amount_naira,description,due_date\n' +
      `A-101,OB-0001,50000.50,Opening service charge,${futureDate(30)}\n`;
    const first = await importFile(financeAdmin, 'opening_balances', csv);
    expect(first).toMatchObject({ createdCount: 1, failedCount: 0 });
    const second = await importFile(financeAdmin, 'opening_balances', csv);
    expect(second).toMatchObject({ createdCount: 0, unchangedCount: 1 });
    const invoices = await stack.db.owner.query<{ total: string }>(
      `select total::text from tenant.invoices where estate_id = $1 and description = 'Opening service charge'`,
      [estateId],
    );
    expect(invoices.rows).toEqual([{ total: '5000050' }]);
  });

  it('fails the job when the confirming user loses the permission before it runs', async () => {
    const job = (await dryRun(admin, 'units', 'code,name\nB-1,Block B 1\n').expect(201)).body
      .data as { id: string };
    await stack.http
      .post(url(`/imports/${job.id}/confirm`))
      .set(as(admin))
      .expect(200);
    await stack.db.owner.query(
      `update platform.role_assignments set revoked_at = now() where user_id = $1 and estate_id = $2`,
      [adminId, estateId],
    );
    await stack.app.get(ImportRunner).run(estateId, job.id);
    const failed = await stack.db.owner.query<{ status: string; created_count: number }>(
      `select status, created_count from tenant.bulk_import_jobs where id = $1`,
      [job.id],
    );
    expect(failed.rows[0]).toEqual({ status: 'failed', created_count: 0 });
    expect(
      await countRows(stack.db.owner, `select count(*) from tenant.spaces where code = 'B-1'`),
    ).toBe(0);
  });
});
