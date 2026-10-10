import { NextResponse } from 'next/server';
import { adminJson, adminRoute } from '@/lib/admin-api';
import { ApiError, deleteEvent, eventMode, existingOptions, loadEvent, updateEvent, withDesignShape } from '@/lib/events';
import { jsonError } from '@/lib/http';
import { validateEvent } from '@/lib/validate';
import { fromUtcDate } from '@/lib/dates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ev = await loadEvent(id);
  if (!ev) return jsonError(404, ['Afstemningen findes ikke.']);
  return NextResponse.json(withDesignShape(ev, new URL(req.url).searchParams.get('tz')), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * Edit (admin). Same body + validation as create, plus optional `id` on existing options and
 * `confirm_remove_voted: true` to delete options that already have votes (else 409).
 * Unchanged existing options may lie in the past; new/moved ones may not.
 */
export const PATCH = adminRoute(async ({ slug, eventId, body }) => {
  const existing = new Map((await existingOptions(eventId)).map((o) => [o.id, o]));
  const mode = await eventMode(eventId); // date polls: options [{id?, date}]; legacy timed polls keep time_options
  const { errors, value } = validateEvent(body, new Date(), {
    allowIds: true, mode,
    pastAllowed: (o) => {
      const e = o.id !== undefined ? existing.get(o.id) : undefined;
      if (!e) return false;
      if (o.date !== null) return !!e.date && fromUtcDate(e.date) === o.date; // already-passed dates may stay
      return e.startAt?.getTime() === o.startAt?.getTime() && (e.endAt?.getTime() ?? null) === (o.endAt?.getTime() ?? null);
    },
  });
  if (errors.length || !value) throw new ApiError(400, errors);
  const confirm = (body as Record<string, unknown>).confirm_remove_voted === true;
  await updateEvent(eventId, value, confirm);
  return adminJson(slug);
});

/** Organizer deletes the whole poll. No body; Bearer admin token; rate limited. 200 { deleted: true }. */
export const DELETE = adminRoute(async ({ eventId }) => {
  await deleteEvent(eventId);
  return NextResponse.json({ deleted: true }, { headers: { 'Cache-Control': 'no-store' } });
}, { json: false });
