import { NextResponse } from 'next/server';
import { cleanup } from '@/lib/invitations';
import { jsonError, logError, NO_STORE } from '@/lib/http';
import { bearerMatches } from '@/lib/webhook';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Daily cleanup (Vercel cron sends GET with `Authorization: Bearer $CRON_SECRET`; a GitHub Action may POST the same).
 * Idempotent: deletes invitee addresses of polls closed > 90 days ago.
 */
async function run(req: Request) {
  if (!bearerMatches(req.headers.get('authorization'), process.env.CRON_SECRET)) return jsonError(401, ['Ikke autoriseret.']);
  try {
    const r = await cleanup();
    return NextResponse.json({ ok: true, ...r }, { headers: NO_STORE });
  } catch (e) { logError('cron cleanup', e); return jsonError(500, ['Serverfejl.']); }
}
export const GET = run;
export const POST = run;
