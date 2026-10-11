/**
 * The ONE place the client IP is read (rate limits, owner login lock, audit log).
 * Order: x-vercel-forwarded-for (set by Vercel's edge, cannot be forged by the client) → x-real-ip (Vercel / our proxy)
 * → the RIGHTMOST x-forwarded-for entry, after skipping TRUSTED_PROXY_HOPS proxies we run ourselves (default 0).
 * Never the leftmost XFF entry: a client can prepend anything there.
 */
const clean = (s: string | null | undefined) => {
  const v = (s ?? '').split(',')[0].trim().replace(/^\[|\]$/g, '').slice(0, 64);
  return /^[0-9A-Fa-f:.]+$/.test(v) ? v : '';
};
export function clientIp(req: Request): string {
  const h = req.headers;
  const vercel = clean(h.get('x-vercel-forwarded-for'));
  if (vercel) return vercel;
  const real = clean(h.get('x-real-ip'));
  if (real) return real;
  const xff = (h.get('x-forwarded-for') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const hops = Math.max(0, Math.floor(Number(process.env.TRUSTED_PROXY_HOPS) || 0));
  const pick = clean(xff[xff.length - 1 - hops]);
  return pick || 'unknown';
}
