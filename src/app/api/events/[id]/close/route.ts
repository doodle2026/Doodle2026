import { adminJson, adminRoute } from '@/lib/admin-api';
import { closeEvent, ApiError } from '@/lib/events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Body: { "chosen_option_id": number | null } (optional final time). */
export const POST = adminRoute(async ({ slug, eventId, body }) => {
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : null) as Record<string, unknown> | null;
  if (!b) throw new ApiError(400, ['Forespørgslen skal være et JSON-objekt.']);
  const c = b.chosen_option_id;
  if (c !== undefined && c !== null && !(typeof c === 'number' && Number.isSafeInteger(c) && c > 0)) {
    throw new ApiError(400, ['Ugyldig valgt dato.']);
  }
  await closeEvent(eventId, (c as number | null | undefined) ?? null);
  return adminJson(slug);
}, { allowEmptyBody: true });
