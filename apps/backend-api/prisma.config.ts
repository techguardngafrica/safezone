import { defineConfig } from 'prisma/config';

// Prisma 7 does not read .env files itself. Load the local one when it exists (never in deployed envs,
// where variables come from the platform).
try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: rely on the process environment.
}

/**
 * Prisma CLI configuration (ADR-0001).
 * Migrations run as the schema owner (DATABASE_MIGRATION_URL), never as safezone_app.
 * The runtime client connects through @prisma/adapter-pg using DATABASE_URL (see src/common/database).
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url:
      process.env.DATABASE_MIGRATION_URL ?? 'postgres://safezone:safezone@localhost:5432/safezone',
  },
});
