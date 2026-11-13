/**
 * @safezone/contracts — the API contract.
 *
 * Flow: backend-api generates openapi.json → `pnpm --filter @safezone/contracts generate`
 * writes src/generated/openapi.d.ts → api-client uses the `paths` type for type-safe calls.
 * Never edit openapi.json or the generated file by hand.
 */
export type { paths, components, operations } from './generated/openapi';

export const API_VERSION = 'v1';
