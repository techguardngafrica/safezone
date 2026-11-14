// Local development and test only: lets safezone_app log in with the password from DATABASE_URL.
// Staging and production set this role's password out of band (vault/Terraform), never with this script.
// Run after `pnpm db:migrate` (the bootstrap migration creates the role without LOGIN).
import pg from 'pg';

if (['staging', 'production'].includes(process.env.NODE_ENV ?? '')) {
  console.error('db:app-role is for local development and tests only.');
  process.exit(1);
}

const ownerUrl =
  process.env.DATABASE_MIGRATION_URL ?? 'postgres://safezone:safezone@localhost:5432/safezone';
const appUrl = new URL(
  process.env.DATABASE_URL ?? 'postgres://safezone_app:safezone_app@localhost:5432/safezone',
);
if (decodeURIComponent(appUrl.username) !== 'safezone_app') {
  console.error('DATABASE_URL must connect as safezone_app.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: ownerUrl });
await client.connect();
try {
  const password = client.escapeLiteral(decodeURIComponent(appUrl.password));
  await client.query(`ALTER ROLE safezone_app WITH LOGIN PASSWORD ${password}`);
  console.warn('safezone_app can now log in.');
} finally {
  await client.end();
}
