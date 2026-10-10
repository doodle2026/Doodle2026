import { adminJson, adminRoute } from '@/lib/admin-api';
import { ApiError, editOption } from '@/lib/events';
import { parseIsoWithOffset } from '@/lib/validate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Edit one time option (admin). Body: { start_at: ISO, end_at: ISO|null, reset_votes: boolean }.
 * 200 → admin event + { reset_votes_count }. 409 duplicate_option, 400 past / invalid.
 */
export const PATCH = adminRoute(async ({ slug, eventId, body, params }) => {
  const oid = Number(params.oid);
  if (!/^\d{1,15}$/.test(String(params.oid))) throw new ApiError(404, ['Tidsforslaget findes ikke.']);
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!b) throw new ApiError(400, ['Forespørgslen skal være et JSON-objekt.']);
  const start = typeof b.start_at === 'string' ? parseIsoWithOffset(b.start_at) : null;
  if (!start) throw new ApiError(400, ['Udfyld dato og starttid.'], { code: 'start_required' });
  let end: Date | null = null;
  if (b.end_at !== undefined && b.end_at !== null && b.end_at !== '') {
    end = typeof b.end_at === 'string' ? parseIsoWithOffset(b.end_at) : null;
    if (!end) throw new ApiError(400, ['Ugyldig sluttid.']);
    if (end <= start) throw new ApiError(400, ['Sluttid skal være efter starttid.'], { code: 'order' });
  }
  if (typeof b.reset_votes !== 'boolean') throw new ApiError(400, ['reset_votes skal være true eller false.']);
  const r = await editOption(eventId, oid, start, end, b.reset_votes);
  return adminJson(slug, { reset_votes_count: r.reset });
});
