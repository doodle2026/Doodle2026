import { NextResponse } from 'next/server';
import { adminEventId, ApiError, loadAdminEvent } from './events';
import { jsonError, logError, NO_STORE, readJson } from './http';
import { rateLimit } from './ratelimit';
import { LIMITS } from './validate';

/** `Authorization: Bearer <token>` → token, else null. The token is never logged. */
export function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+([A-Za-z0-9_-]{1,100})\s*$/i.exec(h);
  return m ? m[1] : null;
}

type Ctx = { params: Promise<{ id: string; pid?: string }> };
type Handler = (a: { req: Request; slug: string; eventId: number; body: unknown; params: { id: string; pid?: string } }) => Promise<Response>;

/**
 * Wraps admin endpoints: rate limit (writes), JSON-only + size cap (writes), Bearer token check
 * (constant-time), uniform no-store/noindex/no-referrer headers, safe error logging.
 */
export function adminRoute(handler: Handler, opts: { write?: boolean; json?: boolean; allowEmptyBody?: boolean } = {}) {
  const write = opts.write ?? true, json = opts.json ?? write, allowEmptyBody = opts.allowEmptyBody ?? false;
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    const res = await (async () => {
      try {
        if (write) { const limited = rateLimit(req); if (limited) return limited; }
        let body: unknown = undefined;
        if (json) {
          const r = await readJson(req, LIMITS.bodyBytes, allowEmptyBody);
          if ('response' in r) return r.response;
          body = r.data;
        }
        const params = await ctx.params;
        const slug = params.id;
        const token = bearer(req);
        const eventId = await adminEventId(slug, token);
        if (eventId === null) {
          return jsonError(token ? 403 : 401, [token ? 'Admin-linket er ugyldigt eller udskiftet.' : 'Mangler admin-adgang.'],
            token ? undefined : { 'WWW-Authenticate': 'Bearer' });
        }
        return await handler({ req, slug, eventId, body, params });
      } catch (e) {
        if (e instanceof ApiError) return NextResponse.json({ errors: e.errors, ...e.extra }, { status: e.status });
        logError('admin API', e);
        return jsonError(500, ['Serverfejl.']);
      }
    })();
    for (const [k, v] of Object.entries(NO_STORE)) res.headers.set(k, v);
    return res;
  };
}

export async function adminJson(slug: string, extra: Record<string, unknown> = {}, status = 200) {
  const ev = await loadAdminEvent(slug);
  if (!ev) return jsonError(404, ['Afstemningen findes ikke.']);
  return NextResponse.json({ ...ev, ...extra }, { status });
}
