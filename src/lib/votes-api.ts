import { NextResponse } from 'next/server';
import { bearer } from './admin-api';
import { ApiError, loadEvent, withDesignShape } from './events';
import { jsonError, logError, NO_STORE } from './http';

/** Common wrapper: ApiError → JSON, other errors logged without request data, no-store/noindex/no-referrer. */
export async function guarded(where: string, fn: () => Promise<Response>): Promise<Response> {
  let res: Response;
  try { res = await fn(); } catch (e) {
    if (e instanceof ApiError) res = NextResponse.json({ errors: e.errors, ...e.extra }, { status: e.status });
    else { logError(where, e); res = jsonError(500, ['Serverfejl.']); }
  }
  for (const [k, v] of Object.entries(NO_STORE)) res.headers.set(k, v);
  return res;
}

export const editBearer = bearer;
export const editPath = (slug: string, token: string) => `/p/${slug}#edit=${token}`;

export async function publicEvent(slug: string) {
  const ev = await loadEvent(slug);
  return ev ? withDesignShape(ev) : null;
}
