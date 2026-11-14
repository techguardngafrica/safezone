import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Wraps secrets stored in the database (estate pass-signing keys, pass PINs) — AGENTS.md §5.7. Local
 * AES-256-GCM with PASS_KEY_ENCRYPTION_KEY today; a KMS implementation can replace it without touching
 * the visitor module.
 */
export abstract class KeyVault {
  abstract wrap(plaintext: Buffer): string;
  abstract unwrap(wrapped: string): Buffer;
}

export class LocalKeyVault extends KeyVault {
  private readonly key: Buffer;

  constructor(keyBase64: string) {
    super();
    this.key = Buffer.from(keyBase64, 'base64');
    if (this.key.length !== 32) throw new Error('KeyVault needs a 32-byte key');
  }

  wrap(plaintext: Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), ciphertext]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  unwrap(wrapped: string): Buffer {
    const [version, iv, tag, ciphertext] = wrapped.split('.');
    if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Malformed wrapped secret');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]);
  }
}
