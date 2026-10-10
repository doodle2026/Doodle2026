import { NextResponse } from 'next/server';
import { IDEMPOTENCY_RE, LIMITS, validateEvent } from '@/lib/validate';
import { adminPath, createEvent, findByIdempotencyKey, loadEvent, withDesignShape } from '@/lib/events';
import { jsonError, readBodyLimited } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 201 (and idempotent 200 replay) is the ONLY place the raw admin token ever leaves the server.
 * Replay returns it too: the caller proved possession of the Idempotency-Key, which is what the
 * token is encrypted under — so a client that lost the first response can still recover its link.
 */
async function respond(slug: string, adminToken: string | null, status: 200 | 201, tz: string | null) {
  const ev = await loadEvent(slug);
  if (!ev) return jsonError(500, ['Serverfejl.']);
  const headers: Record<string, string> = { Location: `/p/${slug}`, 'Cache-Control': 'no-store' };
  if (status === 200) headers['Idempotent-Replayed'] = 'true';
  const admin = adminToken ? { admin_token: adminToken, admin_url: adminPath(slug, adminToken) } : {};
  return NextResponse.json({ ...withDesignShape(ev, tz), ...admin }, { status, headers });
}

export async function POST(req: Request) {
  try {
    // CSRF hardening: only application/json (cross-site forms can't send it without a CORS preflight).
    const ct = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (ct !== 'application/json') return jsonError(415, ['Content-Type skal være application/json.']);
    const tz = new URL(req.url).searchParams.get('tz');
    const idemKey = req.headers.get('idempotency-key') ?? undefined;
    if (idemKey !== undefined && !IDEMPOTENCY_RE.test(idemKey)) {
      return jsonError(400, ['Ugyldig Idempotency-Key (16-100 tegn: A-Z, a-z, 0-9, _ eller -).']);
    }
    // Replay before validation, so a retry after the proposed time passed still returns the poll.
    if (idemKey) {
      const hit = await findByIdempotencyKey(idemKey);
      if (hit) return respond(hit.slug, hit.adminToken, 200, tz);
    }
    const body = await readBodyLimited(req, LIMITS.bodyBytes);
    if ('tooLarge' in body) return jsonError(413, ['Forespørgslen er for stor (maks. 32 kB).']);
    let parsed: unknown;
    try { parsed = JSON.parse(body.text); } catch { return jsonError(400, ['Ugyldig JSON.']); }

    const { errors, value } = validateEvent(parsed, new Date());
    if (errors.length || !value) return jsonError(400, errors);
    const { slug, adminToken, replayed } = await createEvent(value, idemKey);
    return respond(slug, adminToken, replayed ? 200 : 201, tz);
  } catch (e) {
    // Log only the error class/code — never request data (could contain keys) or tokens.
    console.error('POST /api/events failed:', e instanceof Error ? `${e.name}${'code' in e ? ` ${String(e.code)}` : ''}` : 'unknown');
    return jsonError(500, ['Serverfejl.']);
  }
}
