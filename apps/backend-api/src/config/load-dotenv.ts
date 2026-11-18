import { existsSync } from 'node:fs';

/**
 * Loads apps/backend-api/.env (the process working directory) for local development, before anything
 * reads the environment. Variables already set in the real environment win, and deployed environments
 * have no .env file, so this only fills gaps on a developer machine. Imported first by instrument.ts.
 */
if (existsSync('.env')) process.loadEnvFile('.env');
