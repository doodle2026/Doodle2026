import { NextResponse } from 'next/server';
import { OWNER_HEADERS, checkSessionCsrf, sessionFromRequest, type OwnerSessionInfo } from './auth';

export const ownerJson = (body: unknown, status = 200, extra?: Record<string, string>) =>
  NextResponse.json(body, { status, headers: { ...OWNER_HEADERS, ...extra } });

/** Wrap an owner API route: valid session required (401), and for non-GET a valid session CSRF token (403). */
export function ownerRoute(fn: (req: Request, s: OwnerSessionInfo, ctx: unknown) => Promise<Response>) {
  return async (req: Request, ctx: unknown) => {
    const s = await sessionFromRequest(req);
    if (!s) return ownerJson({ errors: ['Log ind for at fortsætte.'], code: 'unauthorized' }, 401);
    if (req.method !== 'GET' && req.method !== 'HEAD' && !checkSessionCsrf(req, s)) return ownerJson({ errors: ['Ugyldig forespørgsel.'], code: 'csrf' }, 403);
    const res = await fn(req, s, ctx);
    for (const [k, v] of Object.entries(OWNER_HEADERS)) res.headers.set(k, v);
    return res;
  };
}
