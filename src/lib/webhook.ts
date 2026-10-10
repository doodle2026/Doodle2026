import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify a Resend (Svix) webhook: HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${rawBody}` with the base64
 * secret after "whsec_"; header `svix-signature` holds space-separated "v1,<base64>" entries. Constant-time
 * compare, ±5 min timestamp tolerance (replay protection).
 */
export function verifySvix(secret: string | undefined, headers: Headers, body: string, now = Date.now()): boolean {
  if (!secret || !secret.startsWith('whsec_')) return false;
  const id = headers.get('svix-id'), ts = headers.get('svix-timestamp'), sig = headers.get('svix-signature');
  if (!id || !ts || !sig || !/^\d{1,12}$/.test(ts)) return false;
  if (Math.abs(now / 1000 - Number(ts)) > 300) return false;
  let key: Buffer;
  try { key = Buffer.from(secret.slice(6), 'base64'); } catch { return false; }
  if (!key.length) return false;
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest();
  return sig.split(' ').some((part) => {
    const [v, b64] = part.split(',');
    if (v !== 'v1' || !b64) return false;
    const got = Buffer.from(b64, 'base64');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** Constant-time Bearer check for the cron secret. */
export function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header) return false;
  const m = /^Bearer\s+(\S+)$/.exec(header);
  if (!m) return false;
  const a = Buffer.from(m[1]), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
