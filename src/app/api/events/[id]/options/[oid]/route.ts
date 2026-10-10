import { adminJson, adminRoute } from '@/lib/admin-api';
import { ApiError, editOption, eventMode } from '@/lib/events';
import { parseIsoWithOffset } from '@/lib/validate';
import { isRealDate, minAllowedDate } from '@/lib/dates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Edit one option (admin). Date polls: { date: 'YYYY-MM-DD', reset_votes }. Legacy timed polls:
 * { start_at: ISO, end_at: ISO|null, reset_votes: boolean }.
 * 200 → admin event + { reset_votes_count }. 409 duplicate_option, 400 past / invalid.
 */
export const PATCH = adminRoute(async ({ slug, eventId, body, params }) => {
  const oid = Number(params.oid);
  if (!/^\d{1,15}$/.test(String(params.oid))) throw new ApiError(404, ['Datoforslaget findes ikke.']);
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!b) throw new ApiError(400, ['Forespørgslen skal være et JSON-objekt.']);
  if (typeof b.reset_votes !== 'boolean') throw new ApiError(400, ['reset_votes skal være true eller false.']);
  // Date polls always; legacy polls too when a date is sent (§0.7: changing date makes it a plain date option).
  if (b.date !== undefined || (await eventMode(eventId)) === 'date') {
    if (!isRealDate(b.date)) throw new ApiError(400, ['Udfyld en gyldig dato.'], { code: 'date_required' });
    const r = await editOption(eventId, oid, { date: b.date, startAt: null, endAt: null }, b.reset_votes, (n) => n.date! < minAllowedDate());
    return adminJson(slug, { reset_votes_count: r.reset });
  }
  const start = typeof b.start_at === 'string' ? parseIsoWithOffset(b.start_at) : null;
  if (!start) throw new ApiError(400, ['Udfyld dato og starttid.'], { code: 'start_required' });
  let end: Date | null = null;
  if (b.end_at !== undefined && b.end_at !== null && b.end_at !== '') {
    end = typeof b.end_at === 'string' ? parseIsoWithOffset(b.end_at) : null;
    if (!end) throw new ApiError(400, ['Ugyldig sluttid.']);
    if (end <= start) throw new ApiError(400, ['Sluttid skal være efter starttid.'], { code: 'order' });
  }
  const r = await editOption(eventId, oid, { date: null, startAt: start, endAt: end }, b.reset_votes, (n) => n.startAt!.getTime() < Date.now());
  return adminJson(slug, { reset_votes_count: r.reset });
});
