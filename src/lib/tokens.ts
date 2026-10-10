import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit random token, base64url (43 chars). */
export const newToken = () => randomBytes(32).toString('base64url');
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Constant-time check of a presented token against a stored SHA-256 hex hash. */
export function tokenMatches(token: string, storedHash: string): boolean {
  if (!TOKEN_RE.test(token) || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  return timingSafeEqual(Buffer.from(sha256Hex(token), 'hex'), Buffer.from(storedHash, 'hex'));
}

// --- Idempotent replay of the admin token -------------------------------------------------------
// The token is encrypted with a key derived from the raw Idempotency-Key (which the DB never sees;
// it stores only sha256(key)). Only the client holding the key can get the token back on replay.
const deriveKey = (idemKey: string) =>
  Buffer.from(hkdfSync('sha256', Buffer.from(idemKey, 'utf8'), Buffer.from('moedetid-idem-v1'), Buffer.from('admin-token'), 32));

export function sealForKey(idemKey: string, plaintext: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', deriveKey(idemKey), iv);
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}

export function openForKey(idemKey: string, sealed: string): string | null {
  try {
    const b = Buffer.from(sealed, 'base64url');
    const d = createDecipheriv('aes-256-gcm', deriveKey(idemKey), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch { return null; }
}
