import { isBareEmail } from '@/lib/email/send';
import { NextResponse } from 'next/server';
import { captureActive } from '@/lib/email/capture';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * TEST ONLY (tester hook). 404 unless capture mode is active (same gate as /api/test/mails).
 * POST {email, event: 'delivered'|'bounced'|'failed'|'unsubscribed', poll?: <id>} → sets the delivery status of matching
 * invitations, like a Resend webhook would. Without `poll`, all invitations to that address are updated.
 * 'unsubscribed' only marks the invitation (delivery 'unsub', previous state kept for resubscribe) – it does not add the
 * address to the suppression list; use the real unsubscribe link for that.
 */
const h = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
export async function POST(req: Request) {
  if (!captureActive()) return NextResponse.json({ errors: ['Ikke fundet.'] }, { status: 404, headers: h });
  const b = (await req.json().catch(() => ({}))) as { email?: unknown; event?: unknown; poll?: unknown };
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const EV = ['delivered', 'bounced', 'failed', 'unsubscribed'] as const;
  const ev = EV.find((e) => e === b.event);
  if (email && !isBareEmail(email)) return NextResponse.json({ errors: ['Ugyldig e-mailadresse.'] }, { status: 400, headers: h });
  if (!email || !ev) return NextResponse.json({ errors: [`email og event (${EV.join('|')}) kræves.`] }, { status: 400, headers: h });
  const where = { email, ...(typeof b.poll === 'string' ? { event: { slug: b.poll } } : {}) };
  const now = new Date();
  if (ev === 'unsubscribed') {
    let n = 0;
    for (const i of await prisma.invitation.findMany({ where, select: { id: true, delivery: true } })) {
      if (i.delivery !== 'unsub') await prisma.invitation.update({ where: { id: i.id }, data: { delivery: 'unsub', deliveryBeforeUnsub: i.delivery, reason: null, lastEventAt: now } });
      n++;
    }
    return NextResponse.json({ updated: n }, { headers: h });
  }
  const data = ev === 'delivered' ? { delivery: 'delivered', reason: null, lastEventAt: now }
    : ev === 'bounced' ? { delivery: 'bounced', reason: 'Afvist af modtagerens server', lastEventAt: now }
    : { delivery: 'failed', reason: 'Kunne ikke sendes', lastEventAt: now };
  const r = await prisma.invitation.updateMany({ where, data });
  return NextResponse.json({ updated: r.count }, { headers: h });
}
