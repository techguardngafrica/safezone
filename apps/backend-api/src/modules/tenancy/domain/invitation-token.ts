import { createHash, createHmac } from 'node:crypto';

/** Invitations expire after 7 days (tenancy.md §4.2). */
export const INVITATION_TTL_MS = 7 * 24 * 3600_000;

/**
 * The link token is derived from the invitation id with a server secret, so it never has to be stored
 * or carried in events: the worker that sends the link derives it again. Only its SHA-256 is stored, for
 * lookup. Rotating the secret invalidates outstanding links.
 */
export function deriveInvitationToken(secret: string, invitationId: string): string {
  return createHmac('sha256', secret)
    .update(`estate-invitation:v1:${invitationId}`)
    .digest('base64url');
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function invitationStatus(
  row: {
    acceptedAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date;
  },
  now: Date = new Date(),
): 'pending' | 'accepted' | 'expired' | 'revoked' {
  if (row.acceptedAt) return 'accepted';
  if (row.revokedAt) return 'revoked';
  return row.expiresAt <= now ? 'expired' : 'pending';
}
