import { createHash } from 'node:crypto';
import { BUILT_IN_ROLES } from '@safezone/permissions';
import type pg from 'pg';

/**
 * Mirrors built-in roles from @safezone/permissions into platform.roles so assignments can reference
 * them. Idempotent; runs as the schema owner after migrations (pnpm db:seed). Permissions of built-in
 * roles are read from the package at runtime, so they are not copied.
 */
export async function seedBuiltInRoles(client: pg.ClientBase): Promise<number> {
  let count = 0;
  for (const role of BUILT_IN_ROLES) {
    const result = await client.query(
      `insert into platform.roles (id, level, key, name, is_builtin, estate_id)
       values ($1, $2, $3, $4, true, null)
       on conflict (estate_id, key) do update set name = excluded.name, level = excluded.level`,
      [builtInRoleId(role.key), role.level, role.key, role.name],
    );
    count += result.rowCount ?? 0;
  }
  return count;
}

/** Stable id per built-in role key (deterministic, so environments share ids). */
export function builtInRoleId(key: string): string {
  // Deterministic UUID (version 8, RFC 9562 custom) from the key's SHA-256.
  const hex = createHash('sha256').update(`safezone-role:${key}`).digest('hex');
  const variant = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}
