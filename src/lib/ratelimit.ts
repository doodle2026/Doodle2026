import { clientIp } from './client-ip';
/**
 * Simple in-memory token bucket per (client IP, bucket name).
 *
 * Serverless caveat: state lives in one function instance. On Vercel each warm instance has its own
 * buckets and cold starts reset them, so this is a best-effort abuse brake, not a hard global limit.
 * For a strict limit, move the buckets to Postgres/Redis (e.g. Upstash) – the interface stays the same.
 */
export interface Limit { capacity: number; refillPerSec: number }
interface Bucket { tokens: number; at: number }

const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);
export const LIMITS = {
  // Defaults: burst 20, then 1 request / 3 s (20/min) per IP for writes.
  write: { capacity: num(process.env.RATE_LIMIT_CAPACITY, 20), refillPerSec: num(process.env.RATE_LIMIT_REFILL_PER_SEC, 1 / 3) },
  // Mail sends (invitations + reminders) per IP: 10 per hour.
  mail: { capacity: num(process.env.RATE_LIMIT_MAIL_PER_HOUR, 150), refillPerSec: num(process.env.RATE_LIMIT_MAIL_PER_HOUR, 150) / 3600 },
  // Public unsubscribe / abuse endpoints.
  public: { capacity: 30, refillPerSec: 0.5 },
} satisfies Record<string, Limit>;

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

export function take(key: string, limit: Limit, now = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
  let b = buckets.get(key);
  if (!b) {
    if (buckets.size >= MAX_KEYS) { const first = buckets.keys().next().value; if (first !== undefined) buckets.delete(first); }
    b = { tokens: limit.capacity, at: now };
    buckets.set(key, b);
  } else {
    b.tokens = Math.min(limit.capacity, b.tokens + ((now - b.at) / 1000) * limit.refillPerSec);
    b.at = now;
  }
  if (b.tokens >= 1) { b.tokens -= 1; return { ok: true }; }
  return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - b.tokens) / limit.refillPerSec)) };
}

export const resetRateLimits = () => buckets.clear();

export { clientIp } from './client-ip';

/** Returns a 429 Response if limited, else null. */
export function rateLimit(req: Request, name: keyof typeof LIMITS = 'write'): Response | null {
  const r = take(`${name}:${clientIp(req)}`, LIMITS[name]);
  if (r.ok) return null;
  return Response.json(
    { errors: ['For mange forespørgsler. Vent lidt, og prøv igen.'], error: 'rate_ip', code: 'ip_limit' /* legacy name, kept for compat */, retry_after: r.retryAfterSec },
    { status: 429, headers: { 'Retry-After': String(r.retryAfterSec), 'Cache-Control': 'no-store' } },
  );
}
