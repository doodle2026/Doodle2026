import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { SLUG_RE, type CleanEvent } from './validate';
import { newToken, openForKey, sealForKey, sha256Hex, tokenMatches, TOKEN_RE } from './tokens';

export interface ApiTimeOption { id: number; start_at: string; end_at: string | null; position: number }
/** Public shape. Must never contain admin/edit tokens or their hashes (asserted in tests). */
export interface ApiEvent {
  id: string; slug: string; title: string; description: string; created_at: string;
  closed_at: string | null; is_closed: boolean;
  time_options: ApiTimeOption[];
}
export interface DesignOption { date: string; start: string; end: string | null; end_date?: string }
export interface ApiEventResponse extends ApiEvent { timezone: string; options: DesignOption[]; url: string }

export const newSlug = () => randomBytes(16).toString('base64url'); // 128 bits → 22 chars
export const adminPath = (slug: string, token: string) => `/p/${slug}/admin/${token}`;

const publicSelect = {
  slug: true, title: true, description: true, createdAt: true, closedAt: true, // explicit allow-list: never adminTokenHash
  timeOptions: {
    select: { id: true, startAt: true, endAt: true, position: true },
    orderBy: [{ startAt: 'asc' }, { endAt: { sort: 'asc', nulls: 'first' } }, { position: 'asc' }],
  },
} satisfies Prisma.EventSelect;

export async function loadEvent(slug: unknown): Promise<ApiEvent | null> {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return null;
  const ev = await prisma.event.findUnique({ where: { slug }, select: publicSelect });
  if (!ev) return null;
  return {
    id: ev.slug, slug: ev.slug, title: ev.title, description: ev.description, created_at: ev.createdAt.toISOString(),
    closed_at: ev.closedAt ? ev.closedAt.toISOString() : null, is_closed: ev.closedAt !== null,
    time_options: ev.timeOptions.map((o) => ({
      id: o.id, start_at: o.startAt.toISOString(), end_at: o.endAt ? o.endAt.toISOString() : null, position: o.position,
    })),
  };
}

export async function pollExists(slug: string): Promise<boolean> {
  return SLUG_RE.test(slug) && (await prisma.event.count({ where: { slug } })) > 0;
}

/** True iff `token` is the admin token of poll `slug` (constant-time hash comparison). */
export async function isAdmin(slug: string, token: string): Promise<boolean> {
  if (!SLUG_RE.test(slug) || !TOKEN_RE.test(token)) return false;
  const ev = await prisma.event.findUnique({ where: { slug }, select: { adminTokenHash: true } });
  return !!ev && tokenMatches(token, ev.adminTokenHash);
}

/** Replay lookup: slug + (decrypted) admin token for a raw Idempotency-Key, or null. */
export async function findByIdempotencyKey(idemKey: string): Promise<{ slug: string; adminToken: string | null } | null> {
  const hit = await prisma.idempotencyKey.findUnique({
    where: { keyHash: sha256Hex(idemKey) },
    select: { adminTokenEnc: true, event: { select: { slug: true } } },
  });
  return hit ? { slug: hit.event.slug, adminToken: openForKey(idemKey, hit.adminTokenEnc) } : null;
}

/**
 * Create the event (and idempotency record) atomically. If another request with the same key commits
 * first, the unique violation rolls this one back and we return the winner's poll and token.
 */
export async function createEvent(v: CleanEvent, idemKey?: string):
  Promise<{ slug: string; adminToken: string | null; replayed: boolean }> {
  const slug = newSlug();
  const adminToken = newToken();
  try {
    await prisma.$transaction(async (tx) => {
      const ev = await tx.event.create({
        data: {
          slug, title: v.title, description: v.description, adminTokenHash: sha256Hex(adminToken),
          timeOptions: { create: v.timeOptions.map((o, i) => ({ startAt: o.startAt, endAt: o.endAt, position: i })) },
        },
        select: { id: true },
      });
      if (idemKey) {
        await tx.idempotencyKey.create({
          data: { keyHash: sha256Hex(idemKey), eventId: ev.id, adminTokenEnc: sealForKey(idemKey, adminToken) },
        });
      }
    });
    return { slug, adminToken, replayed: false };
  } catch (e) {
    if (idemKey && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const existing = await findByIdempotencyKey(idemKey);
      if (existing) return { ...existing, replayed: true };
    }
    throw e;
  }
}

function resolveZone(tz: unknown): string {
  if (typeof tz === 'string' && tz.length > 0 && tz.length <= 64) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { /* invalid → UTC */ }
  }
  return 'UTC';
}

/** Adds the design's data shape: options[{date,start,end}] as wall-clock time in an IANA zone (default UTC). */
export function withDesignShape(ev: ApiEvent, tz?: string | null): ApiEventResponse {
  const zone = resolveZone(tz);
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const parts = (iso: string) => {
    const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  };
  const options = ev.time_options.map((o): DesignOption => {
    const s = parts(o.start_at);
    const e = o.end_at ? parts(o.end_at) : null;
    return { date: s.date, start: s.time, end: e ? e.time : null, ...(e && e.date !== s.date ? { end_date: e.date } : {}) };
  });
  return { ...ev, timezone: zone, options, url: `/p/${ev.slug}` };
}
