import { NextResponse } from 'next/server';
import { loadEvent, withDesignShape } from '@/lib/events';
import { jsonError } from '@/lib/http';

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
