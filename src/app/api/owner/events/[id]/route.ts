import { ownerJson, ownerRoute } from '@/lib/owner/http';
import { eventDetail, logView } from '@/lib/owner/stats';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Detail incl. names and full emails for ops; every view is logged (who/what/when, no IP). Never tokens. */
export const GET = ownerRoute(async (_req, s, ctx) => {
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
  if (!/^[A-Za-z0-9_-]{1,22}$/.test(id)) return ownerJson({ errors: ['Afstemningen findes ikke (længere).'], code: 'not_found' }, 404);
  const d = await eventDetail(id);
  if (!d) return ownerJson({ errors: ['Afstemningen findes ikke (længere).'], code: 'not_found' }, 404);
  await logView(s.userId, s.username, id);
  return ownerJson({ ...d, viewLogged: { user: s.username, at: new Date().toISOString() } });
});
