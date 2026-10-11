/**
 * The ONE place the client IP is read (rate limits, owner login lock, audit log).
 *
 * On Vercel (process.env.VERCEL set): x-vercel-forwarded-for → x-real-ip → rightmost x-forwarded-for.
 *   Vercel's edge overwrites these headers, so the client cannot forge them.
 * Anywhere else those headers are client-controlled and are IGNORED. Instead:
 *   TRUSTED_PROXY_HOPS = N (number of reverse proxies WE run in front of the app, each appending to XFF):
 *     client IP = the N-th entry from the right of x-forwarded-for (the one our outermost proxy appended).
 *   TRUSTED_PROXY_HOPS unset/0 → no proxy is trusted → the socket address (if the runtime exposes it), else 'unknown'
 *     (all such clients then share one rate-limit bucket – fail closed rather than trusting a forgeable header).
 * Never the leftmost XFF entry.
 */
const clean = (s: string | null | undefined) => {
  const v = (s ?? '').split(',')[0].trim().replace(/^\[|\]$/g, '').slice(0, 64);
  return /^[0-9A-Fa-f:.]+$/.test(v) ? v : '';
};
export const trustedHops = () => Math.max(0, Math.floor(Number(process.env.TRUSTED_PROXY_HOPS) || 0));

export function clientIp(req: Request & { ip?: string; socket?: { remoteAddress?: string } }): string {
  const h = req.headers;
  const xff = (h.get('x-forwarded-for') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (process.env.VERCEL) {
    return clean(h.get('x-vercel-forwarded-for')) || clean(h.get('x-real-ip')) || clean(xff[xff.length - 1]) || 'unknown';
  }
  const hops = trustedHops();
  if (hops > 0) return clean(xff[xff.length - hops]) || 'unknown';
  return clean(req.ip) || clean(req.socket?.remoteAddress) || 'unknown';
}
