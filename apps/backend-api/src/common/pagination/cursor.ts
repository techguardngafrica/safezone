import { DomainError } from '../errors/domain-error';

/** Opaque cursors (backend-api.md §6.2): base64url JSON, validated on the way in. */
export function encodeCursor(value: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeCursor<T extends Record<string, unknown>>(
  cursor: string,
  isValid: (value: unknown) => value is T,
): T {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (isValid(value)) return value;
  } catch {
    // fall through
  }
  throw new DomainError('INVALID_CURSOR', 'The page cursor is not valid', 400);
}
