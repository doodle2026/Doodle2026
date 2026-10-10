import { NextResponse } from 'next/server';
import { adminRoute } from '@/lib/admin-api';
import { previewInvitation } from '@/lib/invitations';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Organizer: render the invitation mail as it would be sent (no mail is sent). Body { message?, organizer_name? }. */
export const POST = adminRoute(async ({ eventId, body }) => {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  return NextResponse.json(await previewInvitation(eventId, { message: b.message, organizer_name: b.organizer_name }));
}, { allowEmptyBody: true });
