import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { SLUG_RE, type CleanEvent } from './validate';
import { newToken, openForKey, sealForKey, sha256Hex, tokenMatches, TOKEN_RE } from './tokens';

export interface ApiTimeOption { id: number; start_at: string; end_at: string | null; position: number }
/** Public shape. Must never contain admin/edit tokens or their hashes (asserted in tests). */
export interface ApiEvent {
  id: string; slug: string; title: string; description: string; created_at: string;
  closed_at: string | null; is_closed: boolean; chosen_option_id: number | null;
  time_options: ApiTimeOption[];
  /** Public: names + answers only (votes aligned with time_options; null = not answered). Never tokens. */
  participants: ApiParticipant[];
}
export interface ApiParticipant { id: number; name: string; votes: ('yes' | 'maybe' | 'no' | null)[] }
export interface DesignOption { date: string; start: string; end: string | null; end_date?: string }
export interface ApiEventResponse extends ApiEvent { timezone: string; options: DesignOption[]; url: string }

export const newSlug = () => randomBytes(16).toString('base64url'); // 128 bits → 22 chars
/** Admin link: token in the URL *fragment*, which browsers never send to the server (no logs/Referer). */
export const adminPath = (slug: string, token: string) => `/p/${slug}/admin#${token}`;

const publicSelect = {
  slug: true, title: true, description: true, createdAt: true, closedAt: true, chosenOptionId: true, // explicit allow-list: never adminTokenHash
  timeOptions: {
    select: { id: true, startAt: true, endAt: true, position: true },
    orderBy: [{ startAt: 'asc' }, { endAt: { sort: 'asc', nulls: 'first' } }, { position: 'asc' }],
  },
  participants: {
    select: { id: true, name: true, votes: { select: { timeOptionId: true, value: true } } }, // never editTokenHash
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.EventSelect;

export async function loadEvent(slug: unknown): Promise<ApiEvent | null> {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return null;
  const ev = await prisma.event.findUnique({ where: { slug }, select: publicSelect });
  if (!ev) return null;
  return {
    id: ev.slug, slug: ev.slug, title: ev.title, description: ev.description, created_at: ev.createdAt.toISOString(),
    closed_at: ev.closedAt ? ev.closedAt.toISOString() : null, is_closed: ev.closedAt !== null,
    chosen_option_id: ev.chosenOptionId,
    time_options: ev.timeOptions.map((o) => ({
      id: o.id, start_at: o.startAt.toISOString(), end_at: o.endAt ? o.endAt.toISOString() : null, position: o.position,
    })),
    participants: ev.participants.map((p) => {
      const by = new Map(p.votes.map((v) => [v.timeOptionId, v.value]));
      return { id: p.id, name: p.name, votes: ev.timeOptions.map((o) => by.get(o.id) ?? null) };
    }),
  };
}

export async function pollExists(slug: string): Promise<boolean> {
  return SLUG_RE.test(slug) && (await prisma.event.count({ where: { slug } })) > 0;
}

/** True iff `token` is the admin token of poll `slug` (constant-time hash comparison). */
export async function isAdmin(slug: string, token: string): Promise<boolean> {
  return (await adminEventId(slug, token)) !== null;
}

/** Internal event id if `token` is the admin token of `slug`, else null. Constant-time hash comparison. */
export async function adminEventId(slug: string, token: string | null): Promise<number | null> {
  if (!SLUG_RE.test(slug)) return null;
  const ev = await prisma.event.findUnique({ where: { slug }, select: { id: true, adminTokenHash: true } });
  if (!ev) return null;
  // Always compare (even for malformed tokens) so timing doesn't reveal which check failed.
  return tokenMatches(token && TOKEN_RE.test(token) ? token : '', ev.adminTokenHash) ? ev.id : null;
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

// ---------------------------------------------------------------------------------------------
// Admin

export interface AdminOption extends ApiTimeOption { votes: { yes: number; maybe: number; no: number; total: number } }
export interface AdminEvent extends Omit<ApiEvent, 'time_options'> {
  time_options: AdminOption[];
}

export async function loadAdminEvent(slug: string): Promise<AdminEvent | null> {
  const ev = await loadEvent(slug);
  if (!ev) return null;
  const ids = ev.time_options.map((o) => o.id);
  const counts = await prisma.vote.groupBy({ by: ['timeOptionId', 'value'], where: { timeOptionId: { in: ids } }, _count: { _all: true } });
  const by = new Map<number, AdminOption['votes']>();
  for (const id of ids) by.set(id, { yes: 0, maybe: 0, no: 0, total: 0 });
  for (const c of counts) {
    const v = by.get(c.timeOptionId)!;
    v[c.value] += c._count._all; v.total += c._count._all;
  }
  return { ...ev, time_options: ev.time_options.map((o) => ({ ...o, votes: by.get(o.id)! })) };
}

export class ApiError extends Error {
  constructor(public status: number, public errors: string[], public extra: Record<string, unknown> = {}) { super('ApiError'); }
}

/**
 * Replace title/description/options. Options with `id` are kept (and may be moved), missing ones are
 * deleted, new ones created. Deleting options that have votes requires `confirmRemoveVoted`
 * (else 409 listing them) – their votes are deleted (cascade), other votes are untouched.
 */
export async function updateEvent(eventId: number, v: CleanEvent, confirmRemoveVoted: boolean) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.timeOption.findMany({ where: { eventId }, select: { id: true, _count: { select: { votes: true } } } });
    const existingIds = new Set(existing.map((o) => o.id));
    const unknown = v.timeOptions.filter((o) => o.id !== undefined && !existingIds.has(o.id));
    if (unknown.length) throw new ApiError(400, ['Et eller flere tidsforslag findes ikke (længere). Genindlæs siden.']);
    const keep = new Set(v.timeOptions.map((o) => o.id).filter((x): x is number => x !== undefined));
    const removing = existing.filter((o) => !keep.has(o.id));
    const voted = removing.filter((o) => o._count.votes > 0);
    if (voted.length && !confirmRemoveVoted) {
      throw new ApiError(409, ['Nogle af de fjernede tidsforslag har svar. Bekræft for at slette dem.'],
        { voted_option_ids: voted.map((o) => o.id) });
    }
    if (removing.length) await tx.timeOption.deleteMany({ where: { id: { in: removing.map((o) => o.id) } } });
    await tx.event.update({ where: { id: eventId }, data: { title: v.title, description: v.description } });
    for (const [i, o] of v.timeOptions.entries()) {
      if (o.id !== undefined) await tx.timeOption.update({ where: { id: o.id }, data: { startAt: o.startAt, endAt: o.endAt, position: i } });
      else await tx.timeOption.create({ data: { eventId, startAt: o.startAt, endAt: o.endAt, position: i } });
    }
  });
}

export async function existingOptions(eventId: number) {
  return prisma.timeOption.findMany({ where: { eventId }, select: { id: true, startAt: true, endAt: true } });
}

export async function closeEvent(eventId: number, chosenOptionId: number | null) {
  if (chosenOptionId !== null) {
    const ok = await prisma.timeOption.count({ where: { id: chosenOptionId, eventId } });
    if (!ok) throw new ApiError(400, ['Det valgte tidspunkt findes ikke i afstemningen.']);
  }
  await prisma.event.update({ where: { id: eventId }, data: { closedAt: new Date(), chosenOptionId } });
}

export async function reopenEvent(eventId: number) {
  await prisma.event.update({ where: { id: eventId }, data: { closedAt: null, chosenOptionId: null } });
}

/** New admin token; the old one stops working immediately. Returns the raw token (shown once). */
export async function rotateAdminToken(eventId: number): Promise<string> {
  const token = newToken();
  await prisma.$transaction([
    prisma.event.update({ where: { id: eventId }, data: { adminTokenHash: sha256Hex(token) } }),
    // Replays of the original create must not hand out the old (now dead) token.
    prisma.idempotencyKey.updateMany({ where: { eventId }, data: { adminTokenEnc: '' } }),
  ]);
  return token;
}
