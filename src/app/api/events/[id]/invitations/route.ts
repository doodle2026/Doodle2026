import { NextResponse } from 'next/server';
import { adminRoute } from '@/lib/admin-api';
import { ApiError } from '@/lib/events';
import { listInvitations, sendInvitations, withRemaining } from '@/lib/invitations';
import { rateLimit } from '@/lib/ratelimit';

const MIN_MS = 400;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Organizer: invitation status list, limits and reminder state. */
export const GET = adminRoute(async ({ eventId }) => NextResponse.json(await listInvitations(eventId)), { write: false });

/** Organizer: send invitations. Body { recipients: string | string[], message?: string, organizer_name?: string }. */
export const POST = adminRoute(async ({ req, eventId, body }) => {
  const limited = rateLimit(req, 'mail'); if (limited) return withRemaining(limited, eventId);
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!b) throw new ApiError(400, ['Forespørgslen skal være et JSON-objekt.']);
  const started = Date.now();
  const r = await sendInvitations(eventId, { locale: b.locale, recipients: b.recipients, message: b.message, organizer_name: b.organizer_name, track: b.track });
  const out = { ...r, ...(await listInvitations(eventId)) };
  // Same minimum response time whether or not anything was actually sent (rejected addresses aren't distinguishable by timing).
  const wait = MIN_MS - (Date.now() - started); if (wait > 0) await new Promise((res) => setTimeout(res, wait + Math.random() * 100));
  return NextResponse.json(out, { status: 201 });
}, { ownLimit: true });
