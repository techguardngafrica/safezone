import { describe, expect, it } from 'vitest';
import { deriveAdEnquiryToken, hashAdEnquiryToken } from './enquiry-token';

describe('ad enquiry tracking token', () => {
  const secret = 'test-hmac-secret-at-least-32-chars-long';

  it('derives a deterministic base64url token of valid length', () => {
    const id = '019a0000-0000-7000-8000-000000000001';
    const token1 = deriveAdEnquiryToken(secret, id);
    const token2 = deriveAdEnquiryToken(secret, id);
    expect(token1).toBe(token2);
    expect(token1).toMatch(/^[A-Za-z0-9_-]{40,64}$/);
  });

  it('produces distinct tokens for different enquiries or secrets', () => {
    const t1 = deriveAdEnquiryToken(secret, '019a0000-0000-7000-8000-000000000001');
    const t2 = deriveAdEnquiryToken(secret, '019a0000-0000-7000-8000-000000000002');
    const t3 = deriveAdEnquiryToken(
      'other-secret-at-least-32-chars-long',
      '019a0000-0000-7000-8000-000000000001',
    );
    expect(t1).not.toBe(t2);
    expect(t1).not.toBe(t3);
  });

  it('hashes tokens deterministically as 64-char hex', () => {
    const token = deriveAdEnquiryToken(secret, '019a0000-0000-7000-8000-000000000001');
    const hash = hashAdEnquiryToken(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(hashAdEnquiryToken(token));
    expect(hash).not.toBe(hashAdEnquiryToken(`${token}x`));
  });
});
