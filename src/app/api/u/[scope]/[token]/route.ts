import { NextResponse } from 'next/server';
import { ApiError } from '@/lib/events';
import { linkInfo, setSubscription } from '@/lib/invitations';
import { publicRoute } from '@/lib/public-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Ctx = { params: Promise<{ scope: string; token: string }> };

const scopeOf = (s: string) => (s === 'p' ? 'poll' : s === 'all' ? 'all' : null);

/** State for the landing page (address shown masked by the page). */
export const GET = publicRoute(async (_req: Request, { params }: Ctx) => {
  const { scope, token } = await params;
  if (!scopeOf(scope)) throw new ApiError(404, ['Ukendt link.']);
  const info = await linkInfo(token);
  if (!info) throw new ApiError(404, ['Linket er ugyldigt eller udløbet.']);
  return NextResponse.json(info);
});

/**
 * POST: RFC 8058 one-click (form body "List-Unsubscribe=One-Click" → unsubscribe) or JSON
 * { action: "unsubscribe" | "resubscribe" } from the landing page. Scope from the path: p = this poll, all = all mail.
 */
export const POST = publicRoute(async (req: Request, { params }: Ctx) => {
  const { scope, token } = await params;
  const sc = scopeOf(scope);
  if (!sc) throw new ApiError(404, ['Ukendt link.']);
  const ct = req.headers.get('content-type') ?? '';
  const text = (await req.text()).slice(0, 2000);
  let unsubscribe = true;
  if (ct.includes('application/json')) {
    let a: unknown; try { a = (JSON.parse(text) as { action?: unknown }).action; } catch { a = undefined; }
    if (a !== 'unsubscribe' && a !== 'resubscribe') throw new ApiError(400, ['Ugyldig handling.']);
    unsubscribe = a === 'unsubscribe';
  } else if (!/List-Unsubscribe=One-Click/.test(text)) throw new ApiError(400, ['Ugyldig forespørgsel.']);
  return NextResponse.json(await setSubscription(token, sc, unsubscribe));
});
