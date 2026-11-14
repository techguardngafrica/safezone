import { DomainError } from '../errors/domain-error';

/** Optimistic concurrency (backend-api.md §6): `If-Match: "<version>"`, or null when absent. */
export function parseIfMatchVersion(header: string | undefined): number | null {
  if (header === undefined) return null;
  const value = Number(header.replace(/^W\//, '').replace(/"/g, ''));
  if (!Number.isInteger(value) || value < 1) {
    throw new DomainError('PRECONDITION_FAILED', 'If-Match must be the resource version', 412);
  }
  return value;
}
