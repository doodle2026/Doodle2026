import { NextResponse } from 'next/server';
import { ApiError } from './events';
import { jsonError, logError, NO_STORE } from './http';
import { rateLimit } from './ratelimit';

/** Public (token-in-path) endpoints: rate limited, no-store/noindex/no-referrer, uniform errors. */
export function publicRoute<C>(h: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    let res: Response;
    try {
      res = rateLimit(req, 'public') ?? (await h(req, ctx));
    } catch (e) {
      if (e instanceof ApiError) res = NextResponse.json({ errors: e.errors, ...e.extra }, { status: e.status, headers: e.status === 429 ? { 'Retry-After': String(e.extra.retry_after ?? 3600) } : undefined });
      else { logError('public API', e); res = jsonError(500, ['Serverfejl.']); }
    }
    for (const [k, v] of Object.entries(NO_STORE)) res.headers.set(k, v);
    return res;
  };
}
