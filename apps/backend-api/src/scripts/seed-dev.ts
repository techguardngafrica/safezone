import type pg from 'pg';
import { uuidv7 } from '../common/ids/uuidv7';
import { builtInRoleId } from './seed-roles';

/** Fixed ids and test numbers so local apps and docs can refer to them. Never used outside development. */
export const DEV_SEED = {
  estateId: '01936b2e-0000-7000-8000-000000000001',
  adminUserId: '01936b2e-0000-7000-8000-0000000000a1',
  residentUserId: '01936b2e-0000-7000-8000-0000000000b1',
  superAdminUserId: '01936b2e-0000-7000-8000-0000000000c1',
  adminPhone: '+2348000000001',
  residentPhone: '+2348000000002',
  superAdminPhone: '+2348000000003',
} as const;

/** Demo estate with an estate administrator, a tenant and a platform super admin. Idempotent. */
export async function seedDevelopmentData(client: pg.ClientBase): Promise<string> {
  await client.query(
    `insert into platform.estates (id, name, slug, code, type, address, state, lga, status, onboarding_mode, updated_at)
     values ($1, 'Demo Gardens Estate', 'demo-gardens', 'DEMO01', 'gated_houses', '1 Demo Close, Lekki', 'Lagos', 'Eti-Osa', 'active', 'assisted', now())
     on conflict (id) do nothing`,
    [DEV_SEED.estateId],
  );
  const users: [string, string, string][] = [
    [DEV_SEED.adminUserId, DEV_SEED.adminPhone, 'Demo Administrator'],
    [DEV_SEED.residentUserId, DEV_SEED.residentPhone, 'Demo Resident'],
    [DEV_SEED.superAdminUserId, DEV_SEED.superAdminPhone, 'Demo Super Admin'],
  ];
  for (const [id, phone, name] of users) {
    await client.query(
      `insert into platform.users (id, phone_e164, phone_verified_at, full_name, updated_at)
       values ($1, $2, now(), $3, now()) on conflict (phone_e164) do nothing`,
      [id, phone, name],
    );
  }
  for (const userId of [DEV_SEED.adminUserId, DEV_SEED.residentUserId]) {
    await client.query(
      `insert into tenant.estate_memberships (id, estate_id, user_id, status)
       values ($3, $1, $2, 'active') on conflict (estate_id, user_id) do nothing`,
      [DEV_SEED.estateId, userId, uuidv7()],
    );
  }
  const assignments: [string, string, string | null][] = [
    [DEV_SEED.adminUserId, 'estate_administrator', DEV_SEED.estateId],
    [DEV_SEED.residentUserId, 'tenant', DEV_SEED.estateId],
    [DEV_SEED.superAdminUserId, 'super_admin', null],
  ];
  for (const [userId, roleKey, estateId] of assignments) {
    await client.query(
      `insert into platform.role_assignments (id, user_id, role_id, estate_id, reason)
       select $4, $1, $2, $3, 'development seed'
       where not exists (
         select 1 from platform.role_assignments
          where user_id = $1 and role_id = $2 and estate_id is not distinct from $3 and revoked_at is null)`,
      [userId, builtInRoleId(roleKey), estateId, uuidv7()],
    );
  }
  return `demo estate ${DEV_SEED.estateId}; sign in with ${DEV_SEED.adminPhone} (admin, MFA), ${DEV_SEED.residentPhone} (tenant), ${DEV_SEED.superAdminPhone} (super admin, MFA)`;
}
