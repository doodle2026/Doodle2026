import { NextResponse, type NextRequest } from 'next/server';
import { isAdmin, pollExists } from '@/lib/events';

/** Per-request nonce CSP (Next.js picks the nonce up for its own inline scripts) + security headers. */
export async function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== 'production';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  // Unknown/malformed poll ids → real SSR 404 page. (notFound() thrown from a dynamic page renders
  // only the client error shell in Next 15, so we resolve it here and rewrite to the not-found route.)
  let res: NextResponse;
  if ((await resolvePollPath(req.nextUrl.pathname)) === 'missing') {
    requestHeaders.set('x-not-found', 'poll');
    res = NextResponse.rewrite(new URL('/_not-found', req.url), { request: { headers: requestHeaders } });
  } else {
    res = NextResponse.next({ request: { headers: requestHeaders } });
  }
  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('X-Frame-Options', 'DENY');
  // Secret-bearing URLs (admin token in path, ?edit= token): never indexed, cached or sent as Referer.
  if (isSecretUrl(req)) {
    res.headers.set('Cache-Control', 'no-store, private');
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return res;
}

const isSecretUrl = (req: NextRequest) =>
  /^\/p\/[^/]+\/admin(\/|$)/.test(req.nextUrl.pathname) || req.nextUrl.searchParams.has('edit');

const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return ''; } };

/** /p/<id> and /p/<id>/admin/<token>: resolve existence (and admin token) before rendering. */
async function resolvePollPath(path: string): Promise<'ok' | 'missing' | null> {
  const admin = /^\/p\/([^/]*)\/admin\/([^/]*)\/?$/.exec(path);
  if (admin) return (await isAdmin(safeDecode(admin[1]), safeDecode(admin[2]))) ? 'ok' : 'missing';
  const m = /^\/p\/([^/]*)\/?$/.exec(path);
  if (m) return (await pollExists(safeDecode(m[1]))) ? 'ok' : 'missing';
  return null;
}

export const config = {
  runtime: 'nodejs',
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico|styles.css).*)' }],
};
