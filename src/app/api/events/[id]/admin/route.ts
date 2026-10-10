import { adminJson, adminRoute } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Admin view data (vote counts per option, participants). Bearer admin token required. */
export const GET = adminRoute(async ({ slug }) => adminJson(slug), { write: false });
