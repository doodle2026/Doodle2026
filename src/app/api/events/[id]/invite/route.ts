import { NextResponse } from 'next/server';
import { bearer } from '@/lib/admin-api';
import { ApiError } from '@/lib/events';
import { prisma } from '@/lib/db';
import { inviteByToken } from '@/lib/invitations';
import { publicRoute } from '@/lib/public-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };

/** Personal invite link (#inv=<token>, sent as Bearer): whom it's for + a name suggestion. 404 inactive if revoked/unknown. */
export const GET = publicRoute(async (req: Request, { params }: Ctx) => {
  const ev = await prisma.event.findUnique({ where: { slug: (await params).id }, select: { id: true } });
  if (!ev) throw new ApiError(404, ['Afstemningen findes ikke.']);
  const i = await inviteByToken(ev.id, bearer(req));
  if (!i) throw new ApiError(404, ['Dette link er ikke længere aktivt.'], { code: 'inactive' });
  const local = i.email.split('@')[0].replace(/[._-]+/g, ' ').trim();
  const name_hint = i.name || local.replace(/(^|\s)\p{Ll}/gu, (c) => c.toUpperCase()).slice(0, 80);
  return NextResponse.json({ email: i.email, name_hint, answered: i.participantId !== null });
});
