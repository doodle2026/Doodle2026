import { loadEvent } from '@/lib/events';
import { jsonError } from '@/lib/http';
import { buildIcs, icsDisposition } from '@/lib/ics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Calendar file for the chosen time. Public (same data as the poll page – no tokens, no participants);
 * 404 until the organizer has picked a time. UID is stable per poll+option, so re-importing updates.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ev = await loadEvent((await params).id);
  if (!ev) return jsonError(404, ['Afstemningen findes ikke.']);
  const o = ev.time_options.find((x) => x.id === ev.chosen_option_id);
  if (!o) return jsonError(404, ['Arrangøren har ikke valgt et tidspunkt endnu.']);
  const app = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const host = new URL(app).hostname;
  const body = buildIcs({
    uid: `${ev.slug}-${o.id}@${host}`, stamp: new Date(), start: new Date(o.start_at), end: o.end_at ? new Date(o.end_at) : null,
    summary: ev.title, description: ev.description || undefined, url: `${app}/p/${ev.slug}`,
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': icsDisposition(ev.title),
      'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff',
    },
  });
}
