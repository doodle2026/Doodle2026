/** Test helper: legacy timed polls (mode 'datetime') can no longer be created via the API – insert them directly. */
import type { PrismaClient } from '@prisma/client';
import { newToken, sha256Hex } from '../src/lib/tokens';
import { newSlug } from '../src/lib/events';

export async function createLegacyPoll(prisma: PrismaClient, p: { title?: string; description?: string; options: { start: string; end?: string | null }[] }) {
  const token = newToken(), slug = newSlug();
  const opts = [...p.options].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  await prisma.event.create({
    data: {
      slug, title: p.title ?? 'Legacy', description: p.description ?? '', adminTokenHash: sha256Hex(token), mode: 'datetime',
      timeOptions: { create: opts.map((o, i) => ({ startAt: new Date(o.start), endAt: o.end ? new Date(o.end) : null, position: i })) },
    },
  });
  return { id: slug, admin_token: token };
}
