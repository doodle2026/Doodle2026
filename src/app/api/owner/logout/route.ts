import { cookieHeader, isSecure, logout, sessionCookieName } from '@/lib/owner/auth';
import { ownerJson, ownerRoute } from '@/lib/owner/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = ownerRoute(async (req, s) => {
  await logout(req, s);
  const res = ownerJson({ ok: true });
  res.headers.append('Set-Cookie', cookieHeader(sessionCookieName(isSecure(req)), '', isSecure(req), 0));
  return res;
});
