import { NextResponse } from 'next/server';
import { captureActive } from '@/lib/email/capture';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * TEST ONLY (tester hook). 404 unless capture mode is active (same gate as /api/test/mails).
 * POST {email, event: 'bounced'|'failed', poll?: <id>} → sets the delivery status of matching invitations,
 * like a Resend webhook would. Without `poll`, all invitations to that address are updated.
 */
const h = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
export async function POST(req: Request) {
  if (!captureActive()) return NextResponse.json({ errors: ['Ikke fundet.'] }, { status: 404, headers: h });
  const b = (await req.json().catch(() => ({}))) as { email?: unknown; event?: unknown; poll?: unknown };
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!email || (b.event !== 'bounced' && b.event !== 'failed')) return NextResponse.json({ errors: ['email og event (bounced|failed) kræves.'] }, { status: 400, headers: h });
  const r = await prisma.invitation.updateMany({
    where: { email, ...(typeof b.poll === 'string' ? { event: { slug: b.poll } } : {}) },
    data: b.event === 'bounced' ? { delivery: 'bounced', reason: 'Afvist af modtagerens server', lastEventAt: new Date() } : { delivery: 'failed', reason: 'Kunne ikke sendes', lastEventAt: new Date() },
  });
  return NextResponse.json({ updated: r.count }, { headers: h });
}
