import { NextResponse } from 'next/server';
import { adminRoute, bearer } from '@/lib/admin-api';
import { rateLimit } from '@/lib/ratelimit';
import { sendToSelf, selfStatus } from '@/lib/self-send';
import { explicitRequestLocale } from '@/i18n/req-locale';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MIN_MS = 400;

/** Organizer: how many self-sends are left and when the next is allowed. */
export const GET = adminRoute(async ({ eventId }) => NextResponse.json(await selfStatus(eventId)), { write: false });

/** Organizer: mail the admin link to ONE address. Body { email, locale? } – nothing else is accepted. */
export const POST = adminRoute(async ({ req, eventId, body }) => {
  const limited = rateLimit(req, 'mail'); // existing per-IP hourly mail bucket
  if (limited) { const b = await limited.json(); return NextResponse.json({ ...b, ok: false, error: 'hour', reason: 'hour', code: 'rate_ip' }, { status: 429, headers: limited.headers }); }
  const started = Date.now();
  try {
    return NextResponse.json(await sendToSelf(eventId, bearer(req)!, req, body, explicitRequestLocale(req)), { status: 200 });
  } finally {
    // Same minimum time for sent / refused (suppressed) addresses.
    const wait = MIN_MS - (Date.now() - started); if (wait > 0) await new Promise((r) => setTimeout(r, wait + Math.random() * 100));
  }
}, { ownLimit: true });
