import { adminJson, adminRoute } from '@/lib/admin-api';
import { ApiError, chooseOption } from '@/lib/events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Body: { "chosen_option_id": number | null } – pick, change or clear the final time (open or closed poll). */
export const POST = adminRoute(async ({ slug, eventId, body }) => {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!b || !('chosen_option_id' in b)) throw new ApiError(400, ['chosen_option_id mangler (tal eller null).']);
  const c = b.chosen_option_id;
  if (c !== null && !(typeof c === 'number' && Number.isSafeInteger(c) && c > 0)) throw new ApiError(400, ['Ugyldig valgt dato.']);
  await chooseOption(eventId, c as number | null);
  return adminJson(slug);
});
