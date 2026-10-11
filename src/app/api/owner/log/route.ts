import { ownerJson, ownerRoute } from '@/lib/owner/http';
import { activityLog } from '@/lib/owner/stats';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Read-only activity log (logins + detail views), 50 per page, ?type=login_ok|login_failed|locked|logout|view. No export. */
export const GET = ownerRoute(async (req) => {
  const u = new URL(req.url).searchParams;
  return ownerJson(await activityLog(u.get('type') ?? undefined, u.get('page')));
});
