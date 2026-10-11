import { prisma } from '@/lib/db';
import { loadEvent } from '@/lib/events';
import { jsonError } from '@/lib/http';
import { buildIcs, icsDisposition } from '@/lib/ics';
import { stripInvisible } from '@/lib/validate';
import { icsTexts, mailLocale } from '@/lib/email/render';
import { explicitRequestLocale } from '@/i18n/req-locale';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Calendar file for the chosen time. Public (same data as the poll page – no tokens, no participants);
 * 404 until the organizer has picked a time. UID is stable per POLL and SEQUENCE/LAST-MODIFIED change with
 * the chosen time, so re-importing after a change updates the existing calendar entry.
 */
/** Fixed UID domain (not APP_URL's host) so UIDs stay stable across preview/vercel.app/custom domain. */
const ICS_UID_DOMAIN = 'grabaday.com';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ev = await loadEvent((await params).id);
  if (!ev) return jsonError(404, ['Afstemningen findes ikke.']);
  const o = ev.time_options.find((x) => x.id === ev.chosen_option_id);
  if (!o) return jsonError(404, ['Arrangøren har ikke valgt en dato endnu.']);
  const meta = await prisma.event.findUnique({ where: { slug: ev.slug }, select: { locale: true, icsSequence: true, chosenChangedAt: true, createdAt: true } });
  const app = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  // Language: ?locale= (our pages pass the active one) → cookie/Accept-Language → poll language.
  const q = new URL(req.url).searchParams.get('locale');
  const L = mailLocale(q, q ? null : explicitRequestLocale(req), meta?.locale);
  const url = `${app}/${L}/p/${ev.slug}`;
  const tx = icsTexts(stripInvisible(ev.title), url, L);
  const desc = [stripInvisible(ev.description), tx.description].filter(Boolean).join('\n\n');
  const body = buildIcs({
    uid: `${ev.slug}@${ICS_UID_DOMAIN}`, stamp: new Date(), sequence: meta?.icsSequence ?? 0,
    lastModified: meta?.chosenChangedAt ?? meta?.createdAt,
    date: o.date,
    summary: tx.summary, description: desc, url, lang: L,
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': icsDisposition(ev.title),
      'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff',
    },
  });
}
