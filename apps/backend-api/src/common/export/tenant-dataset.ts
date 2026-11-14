import type { DatabaseService } from '../database/database.service';
import type { Tx } from '../database/tenant-context';
import type { ExportRow } from './csv';
import type { ExportDataset } from './export-registry';

const MAX_ROWS = 500_000;

/**
 * A dataset read inside the estate's tenant context (RLS applies). `omit` drops columns that must never
 * leave the system (secrets, credentials, hashes).
 */
export function tenantDataset(
  db: DatabaseService,
  name: string,
  query: (tx: Tx, estateId: string, take: number) => Promise<ExportRow[]>,
  omit: readonly string[] = [],
): ExportDataset {
  return {
    name,
    rows: (estateId) =>
      db.withTenant(
        { estateId, userId: null },
        async (tx) => {
          const rows = await query(tx, estateId, MAX_ROWS);
          if (omit.length === 0) return rows;
          return rows.map((row) =>
            Object.fromEntries(Object.entries(row).filter(([key]) => !omit.includes(key))),
          );
        },
        { timeout: 120_000 },
      ),
  };
}
