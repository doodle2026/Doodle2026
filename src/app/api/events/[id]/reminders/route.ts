import { NextResponse } from 'next/server';
import { adminRoute } from '@/lib/admin-api';
import { listInvitations, sendReminder } from '@/lib/invitations';
import { rateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Organizer: manual reminder to all non-unsubscribed, non-bounced invitees (≤ 1 per 24 h, 3 per poll, not when closed). */
export const POST = adminRoute(async ({ req, eventId }) => {
  const limited = rateLimit(req, 'mail'); if (limited) return limited;
  const r = await sendReminder(eventId);
  return NextResponse.json({ ...r, ...(await listInvitations(eventId)) }, { status: 201 });
}, { json: false });
