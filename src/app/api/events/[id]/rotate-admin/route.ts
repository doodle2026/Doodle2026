import { adminJson, adminRoute } from '@/lib/admin-api';
import { adminPath, rotateAdminToken } from '@/lib/events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Issues a new admin token (returned once); the old link stops working immediately. */
export const POST = adminRoute(async ({ slug, eventId }) => {
  const token = await rotateAdminToken(eventId);
  return adminJson(slug, { admin_token: token, admin_url: adminPath(slug, token) });
}, { allowEmptyBody: true });
