import { NextResponse } from 'next/server';
import { adminJson, adminRoute } from '@/lib/admin-api';
import { ApiError, existingOptions, loadEvent, updateEvent, withDesignShape } from '@/lib/events';
import { jsonError } from '@/lib/http';
import { validateEvent } from '@/lib/validate';

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
  const { errors, value } = validateEvent(body, new Date(), {
    allowIds: true,
    pastAllowed: (o) => {
      const e = o.id !== undefined ? existing.get(o.id) : undefined;
      return !!e && e.startAt.getTime() === o.startAt.getTime() && (e.endAt?.getTime() ?? null) === (o.endAt?.getTime() ?? null);
    },
  });
  if (errors.length || !value) throw new ApiError(400, errors);
  const confirm = (body as Record<string, unknown>).confirm_remove_voted === true;
  await updateEvent(eventId, value, confirm);
  return adminJson(slug);
});
