import { NextResponse } from 'next/server';
import { adminRoute } from '@/lib/admin-api';
import { ApiError } from '@/lib/events';
import { listInvitations, sendInvitations } from '@/lib/invitations';
import { rateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Organizer: invitation status list, limits and reminder state. */
export const GET = adminRoute(async ({ eventId }) => NextResponse.json(await listInvitations(eventId)), { write: false });

/** Organizer: send invitations. Body { recipients: string | string[], message?: string, organizer_name?: string }. */
export const POST = adminRoute(async ({ req, eventId, body }) => {
  const limited = rateLimit(req, 'mail'); if (limited) return limited;
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!b) throw new ApiError(400, ['Forespørgslen skal være et JSON-objekt.']);
  const r = await sendInvitations(eventId, { recipients: b.recipients, message: b.message, organizer_name: b.organizer_name, track: b.track });
  return NextResponse.json({ ...r, ...(await listInvitations(eventId)) }, { status: 201 });
});
