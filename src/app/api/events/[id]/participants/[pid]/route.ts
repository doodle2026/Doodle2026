import { adminJson, adminRoute } from '@/lib/admin-api';
import { ApiError, deleteParticipant } from '@/lib/events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Organizer deletes a participant (and their votes). No body; rate limited; Bearer admin token. */
export const DELETE = adminRoute(async ({ slug, eventId, params }) => {
  const pid = Number(params.pid);
  if (!/^\d{1,15}$/.test(params.pid ?? '') || !Number.isSafeInteger(pid) || pid <= 0) throw new ApiError(404, ['Deltageren findes ikke.']);
  await deleteParticipant(eventId, pid);
  return adminJson(slug);
}, { json: false });
