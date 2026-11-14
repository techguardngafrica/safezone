/**
 * pnpm db:seed — reference data every environment needs (built-in roles). Runs as the schema owner.
 * pnpm db:seed:dev — adds a demo estate and accounts for local development only.
 */
import pg from 'pg';
import { seedBuiltInRoles } from './seed-roles';
import { seedDevelopmentData } from './seed-dev';

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Use the process environment.
  }
  const ownerUrl =
    process.env.DATABASE_MIGRATION_URL ?? 'postgres://safezone:safezone@localhost:5432/safezone';
  const withDev = process.argv.includes('--dev');
  if (withDev && ['staging', 'production'].includes(process.env.NODE_ENV ?? '')) {
    throw new Error('db:seed:dev is for local development only');
  }

  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query('begin');
    const roles = await seedBuiltInRoles(client);
    console.warn(`built-in roles synced (${roles})`);
    if (withDev) {
      const summary = await seedDevelopmentData(client);
      console.warn(summary);
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'seed failed');
  process.exit(1);
});
