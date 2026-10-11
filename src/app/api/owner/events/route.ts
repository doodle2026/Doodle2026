import { ownerJson, ownerRoute } from '@/lib/owner/http';
import { listEvents } from '@/lib/owner/stats';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET ?q=&status=open|closed&pl=en|da|fr|de&period=today|7|30|90&sort=&dir=asc|desc&page= – 50 per page. No export. */
export const GET = ownerRoute(async (req) => {
  const u = new URL(req.url).searchParams;
  const g = (k: string) => u.get(k) ?? undefined;
  return ownerJson(await listEvents({ q: g('q'), status: g('status'), pl: g('pl'), period: g('period'), sort: g('sort'), dir: g('dir'), page: Number(g('page')) || 1 }));
});
