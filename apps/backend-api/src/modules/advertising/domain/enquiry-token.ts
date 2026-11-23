import { createHash, createHmac } from 'node:crypto';

/**
 * The enquiry status link token is derived from the enquiry id with a server secret, matching the
 * estate invitation token design (tenancy/domain/invitation-token.ts). Only its SHA-256 hash is
 * stored in the database for lookup.
 */
export function deriveAdEnquiryToken(secret: string, enquiryId: string): string {
  return createHmac('sha256', secret).update(`ad-enquiry:v1:${enquiryId}`).digest('base64url');
}

export function hashAdEnquiryToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
