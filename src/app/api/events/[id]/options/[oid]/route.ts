import { adminJson, adminRoute } from '@/lib/admin-api';
import { ApiError, editOption } from '@/lib/events';
import { isRealDate, minAllowedDate } from '@/lib/dates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Edit one option (admin): { date: 'YYYY-MM-DD', reset_votes: boolean }.
 * 200 → admin event + { reset_votes_count }. 409 duplicate_option, 400 past / invalid.
 */
export const PATCH = adminRoute(async ({ slug, eventId, body, params }) => {
  const oid = Number(params.oid);
  if (!/^\d{1,15}$/.test(String(params.oid))) throw new ApiError(404, ['Datoforslaget findes ikke.']);
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!b) throw new ApiError(400, ['Forespørgslen skal være et JSON-objekt.']);
  if (typeof b.reset_votes !== 'boolean') throw new ApiError(400, ['reset_votes skal være true eller false.']);
  if (!isRealDate(b.date)) throw new ApiError(400, ['Udfyld en gyldig dato.'], { code: 'date_required' });
  const r = await editOption(eventId, oid, b.date, b.reset_votes, (d) => d < minAllowedDate());
  return adminJson(slug, { reset_votes_count: r.reset });
});
