import { NextResponse } from 'next/server';
import { adminRoute } from '@/lib/admin-api';
import { ApiError } from '@/lib/events';
import { linkAnswer, listInvitations, resendInvite, retryFailed, retryInvite, revokeInvite, unlinkAnswer } from '@/lib/invitations';
import { rateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Organizer actions on one invitee (step 5), body { email, ... }:
 * resend (new personal link, old one dies) · revoke { reissue?: boolean } · link { participant_id } · unlink.
 */
export const POST = adminRoute(async ({ req, eventId, body, params }) => {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const action = (params as { action?: string }).action;
  let r: object;
  if (action === 'retry') { const l = rateLimit(req, 'mail'); if (l) return l; r = Array.isArray(b.emails) ? await retryFailed(eventId, b.emails) : await retryInvite(eventId, b.email); }
  else if (action === 'resend') { const l = rateLimit(req, 'mail'); if (l) return l; r = await resendInvite(eventId, b.email); }
  else if (action === 'revoke') { if (b.reissue === true) { const l = rateLimit(req, 'mail'); if (l) return l; } r = await revokeInvite(eventId, b.email, b.reissue); }
  else if (action === 'link') r = await linkAnswer(eventId, b.email, b.participant_id);
  else if (action === 'unlink') r = await unlinkAnswer(eventId, b.email);
  else throw new ApiError(404, ['Ukendt handling.']);
  return NextResponse.json({ ...r, ...(await listInvitations(eventId)) });
});
