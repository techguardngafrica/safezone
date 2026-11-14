import { randomInt } from 'node:crypto';

/** No 0/O, 1/I/L: join codes are read aloud and typed on phones. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Short estate join code shown to residents, e.g. "K7M2QX". Uniqueness is enforced by the database. */
export function generateEstateCode(length = 6): string {
  let code = '';
  for (let index = 0; index < length; index += 1)
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** URL slug from the estate name plus a short random suffix (names are not unique). */
export function generateEstateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${base || 'estate'}-${generateEstateCode(4).toLowerCase()}`;
}
