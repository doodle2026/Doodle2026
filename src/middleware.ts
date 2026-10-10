import { NextResponse, type NextRequest } from 'next/server';
import { pollExists } from '@/lib/events';
import { LOCALE_COOKIE, detectLocale, isLocale, type Locale } from '@/i18n/config';

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
  // Locales (always prefixed): /<en|da|fr|de>/…  Unprefixed page paths → 308 to the detected locale
  // (cookie NEXT_LOCALE → Accept-Language → en), query preserved; the browser keeps #fragments across redirects.
  // Unknown/malformed poll ids → real SSR 404 page (rewrite to the not-found route).
  let res: NextResponse;
  const full = req.nextUrl.pathname;
  const seg = full.split('/')[1];
  const prefixed = isLocale(seg);
  const locale: Locale = prefixed ? seg : detectLocale(req.cookies.get(LOCALE_COOKIE)?.value, req.headers.get('accept-language'));
  const path = prefixed ? full.slice(seg.length + 1) || '/' : full;
  const L = (p: string) => (p === '/' ? `/${locale}` : `/${locale}${p}`);
  requestHeaders.set('x-locale', locale);
  requestHeaders.set('x-path', path); // locale-less path, for hreflang alternates
  const legacyAdmin = /^\/p\/([^/]+)\/admin\/([^/]+)\/?$/.exec(path);
  const legacyEvent = /^\/e\/([A-Za-z0-9_-]{1,64})\/?$/.exec(path);
  if (legacyAdmin) {
    // Old form /p/<id>/admin/<token> → token moves into the fragment (never sent to servers again).
    // 302 + no-store so no cache keeps the token; no DB lookup, same response for valid/invalid tokens.
    res = redirect(req, `${L(`/p/${legacyAdmin[1]}/admin`)}#${legacyAdmin[2]}`, 302);
  } else if (/^\/p\/[^/]+$/.test(path) && req.nextUrl.searchParams.has('edit')) {
    // Old form /p/<id>?edit=<token> → /<locale>/p/<id>#edit=<token> (fragment; sent only as Bearer to the API).
    const t = req.nextUrl.searchParams.get('edit') ?? '';
    res = redirect(req, `${L(path)}#edit=${/^[A-Za-z0-9_-]{1,100}$/.test(t) ? t : ''}`, 302);
  } else if (legacyEvent) {
    res = redirect(req, L(`/p/${legacyEvent[1]}`), 301); // very old /e/<id> links
  } else if (path.length > 1 && path.endsWith('/')) {
    // We handle trailing-slash redirects ourselves (skipTrailingSlashRedirect) so they get our headers.
    res = redirect(req, L(path.replace(/\/+$/, '')) + req.nextUrl.search, 308);
  } else if (!prefixed) {
    res = redirect(req, L(path) + req.nextUrl.search, 308);
  } else if (!knownPage(path) || (await resolvePollPath(path)) === 'missing') {
    if (/^\/p\//.test(path)) requestHeaders.set('x-not-found', 'poll');
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

/** Admin pages, ?edit= and mail-token pages (unsubscribe / report abuse / old /e), with or without a locale prefix. */
const isSecretUrl = (req: NextRequest) => {
  const p = req.nextUrl.pathname.replace(/^\/(en|da|fr|de)(?=\/|$)/, '');
  return /^\/p\/[^/]+\/admin(\/|$)/.test(p) || req.nextUrl.searchParams.has('edit') || /^\/(u\/(p|all)|abuse)\//.test(p);
};

/** Page routes that exist under /<locale>; anything else → 404 page. */
const knownPage = (p: string) => p === '/' || /^\/p\/[^/]+(\/admin)?$/.test(p) || /^\/(u\/(p|all)|abuse)\/[^/]+$/.test(p);

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
  // NOT matched: /api/* (incl. cron + webhooks), _next, brand/email assets, any file with an extension, OG image routes.
  matcher: [{ source: '/((?!api(?:/|$)|_next/|brand/|email-assets/|favicon|.*\\..*|.*/opengraph-image(?:$|/|\\?)).*)' }],
};
