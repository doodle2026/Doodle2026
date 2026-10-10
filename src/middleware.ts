import { NextResponse, type NextRequest } from 'next/server';
import { pollExists } from '@/lib/events';

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
  const path = req.nextUrl.pathname;
  const legacyAdmin = /^\/p\/([^/]+)\/admin\/([^/]+)\/?$/.exec(path);
  if (legacyAdmin) {
    // Old form /p/<id>/admin/<token> → token moves into the fragment (never sent to servers again).
    // 302 + no-store so no cache keeps the token; no DB lookup, same response for valid/invalid tokens.
    res = redirect(req, `/p/${legacyAdmin[1]}/admin#${legacyAdmin[2]}`, 302);
  } else if (/^\/p\/[^/]+$/.test(path) && req.nextUrl.searchParams.has('edit')) {
    // Old form /p/<id>?edit=<token> → /p/<id>#edit=<token> (fragment; sent only as Bearer to the API).
    const t = req.nextUrl.searchParams.get('edit') ?? '';
    res = redirect(req, `${path}#edit=${/^[A-Za-z0-9_-]{1,100}$/.test(t) ? t : ''}`, 302);
  } else if (path.length > 1 && path.endsWith('/')) {
    // We handle trailing-slash redirects ourselves (skipTrailingSlashRedirect) so they get our headers.
    res = redirect(req, path.replace(/\/+$/, '') + req.nextUrl.search, 308);
  } else if ((await resolvePollPath(path)) === 'missing') {
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
  /^\/p\/[^/]+\/admin(\/|$)/.test(req.nextUrl.pathname) ||
  /^\/api\/events\/[^/]+\/(admin|close|reopen|rotate-admin)\/?$/.test(req.nextUrl.pathname) ||
  (req.method === 'PATCH' && req.nextUrl.pathname.startsWith('/api/')) ||
  req.nextUrl.searchParams.has('edit') ||
  // Mail footer tokens (unsubscribe / report abuse) in page and API paths.
  /^\/(api\/)?(u\/(p|all)|abuse)\//.test(req.nextUrl.pathname);

/** Location built on APP_URL (not the Host header); Next emits same-origin redirects as relative paths. */
const redirect = (req: NextRequest, location: string, status: 301 | 302 | 308) =>
  NextResponse.redirect(new URL(location, process.env.APP_URL || req.nextUrl.origin), status);

const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return ''; } };

/** /p/<id> and /p/<id>/admin: poll must exist (the admin token is checked client→API, it never reaches pages). */
async function resolvePollPath(path: string): Promise<'ok' | 'missing' | null> {
  const m = /^\/p\/([^/]*)(?:\/admin)?$/.exec(path);
  if (m) return (await pollExists(safeDecode(m[1]))) ? 'ok' : 'missing';
  return null;
}

export const config = {
  runtime: 'nodejs',
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico|styles.css).*)' }],
};
