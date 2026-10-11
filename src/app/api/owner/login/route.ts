import { audit, checkPreCsrf, cookieHeader, isSecure, login, normUsername, preCookieName, readCookie, sameOrigin, sessionCookieName, SESSION_ABS_MS } from '@/lib/owner/auth';
import { ownerJson } from '@/lib/owner/http';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST {username, password} + X-CSRF-Token (from GET /api/owner/csrf). Same error for unknown user and wrong password. */
export async function POST(req: Request) {
  const body = await readJson(req, 4096);
  if ('response' in body) return body.response;
  const b = (body.data ?? {}) as { username?: unknown; password?: unknown };
  if (!sameOrigin(req) || !checkPreCsrf(req)) {
    await audit(req, normUsername(b.username), null, false, 'bad_csrf');
    return ownerJson({ errors: ['Ugyldig forespørgsel. Genindlæs siden, og prøv igen.'], code: 'csrf' }, 403);
  }
  const secure = isSecure(req);
  const r = await login(req, b.username, b.password, readCookie(req, sessionCookieName(secure)));
  if (!r.ok) {
    return ownerJson({ errors: [r.error], code: r.status === 429 ? 'locked' : r.status === 503 ? 'not_configured' : 'bad_credentials', ...(r.retryAfter ? { retry_after: r.retryAfter } : {}) }, r.status,
      r.retryAfter ? { 'Retry-After': String(r.retryAfter) } : undefined);
  }
  const res = ownerJson({ ok: true });
  res.headers.append('Set-Cookie', cookieHeader(sessionCookieName(secure), r.cookie, secure, SESSION_ABS_MS / 1000));
  res.headers.append('Set-Cookie', cookieHeader(preCookieName(secure), '', secure, 0));
  return res;
}
