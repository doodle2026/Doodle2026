import { ownerJson, ownerRoute } from '@/lib/owner/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Who am I + the session-bound CSRF token for state-changing owner calls. Never the session id. */
export const GET = ownerRoute(async (_req, s) => ownerJson({ username: s.username, csrf: s.csrf }));
