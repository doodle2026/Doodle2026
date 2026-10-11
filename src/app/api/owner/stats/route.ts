import { ownerJson, ownerRoute } from '@/lib/owner/http';
import { ownerStats } from '@/lib/owner/stats';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Aggregate numbers only (cached 60 s). */
export const GET = ownerRoute(async () => ownerJson(await ownerStats()));
