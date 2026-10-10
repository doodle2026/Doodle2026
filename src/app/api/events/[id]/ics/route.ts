import { prisma } from '@/lib/db';
import { loadEvent } from '@/lib/events';
import { jsonError } from '@/lib/http';
import { buildIcs, icsDisposition } from '@/lib/ics';
import { stripInvisible } from '@/lib/validate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Calendar file for the chosen time. Public (same data as the poll page – no tokens, no participants);
 * 404 until the organizer has picked a time. UID is stable per POLL and SEQUENCE/LAST-MODIFIED change with
 * the chosen time, so re-importing after a change updates the existing calendar entry.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ev = await loadEvent((await params).id);
  if (!ev) return jsonError(404, ['Afstemningen findes ikke.']);
  const o = ev.time_options.find((x) => x.id === ev.chosen_option_id);
  if (!o) return jsonError(404, ['Arrangøren har ikke valgt et tidspunkt endnu.']);
  const meta = await prisma.event.findUnique({ where: { slug: ev.slug }, select: { icsSequence: true, chosenChangedAt: true, createdAt: true } });
  const app = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const host = new URL(app).hostname;
  const body = buildIcs({
    uid: `${ev.slug}@${host}`, stamp: new Date(), sequence: meta?.icsSequence ?? 0,
    lastModified: meta?.chosenChangedAt ?? meta?.createdAt, start: new Date(o.start_at), end: o.end_at ? new Date(o.end_at) : null,
    summary: stripInvisible(ev.title), description: stripInvisible(ev.description) || undefined, url: `${app}/p/${ev.slug}`,
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': icsDisposition(ev.title),
      'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff',
    },
  });
}
