import { adminJson, adminRoute } from '@/lib/admin-api';
import { reopenEvent } from '@/lib/events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = adminRoute(async ({ slug, eventId }) => {
  await reopenEvent(eventId);
  return adminJson(slug);
}, { allowEmptyBody: true });
