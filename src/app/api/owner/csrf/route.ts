import { cookieHeader, isSecure, newPreToken, preCookieName } from '@/lib/owner/auth';
import { ownerJson } from '@/lib/owner/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Pre-login CSRF token (double submit): HttpOnly SameSite=Strict cookie + the same value in the body for X-CSRF-Token. */
export async function GET(req: Request) {
  const tok = newPreToken();
  const res = ownerJson({ csrf: tok });
  res.headers.append('Set-Cookie', cookieHeader(preCookieName(isSecure(req)), tok, isSecure(req), 600));
  return res;
}
