import { NextResponse } from 'next/server';
import { ApiError } from '@/lib/events';
import { readJson } from '@/lib/http';
import { linkInfo, reportAbuse } from '@/lib/invitations';
import { publicRoute } from '@/lib/public-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Ctx = { params: Promise<{ token: string }> };

export const GET = publicRoute(async (_req: Request, { params }: Ctx) => {
  const info = await linkInfo((await params).token);
  if (!info) throw new ApiError(404, ['Linket er ugyldigt eller udløbet.']);
  return NextResponse.json({ title: info.title });
});

/** Body { reason: spam|unknown_sender|phishing|other, details?: string, unsubscribe?: boolean (default true) }. */
export const POST = publicRoute(async (req: Request, { params }: Ctx) => {
  const r = await readJson(req, 4096);
  if ('response' in r) return r.response;
  const b = (r.data && typeof r.data === 'object' ? r.data : {}) as Record<string, unknown>;
  return NextResponse.json(await reportAbuse((await params).token, b.reason, b.details, b.unsubscribe), { status: 201 });
});
