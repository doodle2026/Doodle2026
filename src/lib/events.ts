import { bumpStat } from '@/lib/owner/counters';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { SLUG_RE, type CleanEvent } from './validate';
import { fromUtcDate, toUtcDate } from './dates';
import { newToken, openForKey, sealForKey, sha256Hex, tokenMatches, TOKEN_RE } from './tokens';

/** date: 'YYYY-MM-DD' (whole day, no time zone). */
export interface ApiTimeOption { id: number; date: string; position: number }
/** Public shape. Must never contain admin/edit tokens or their hashes (asserted in tests). */
export interface ApiEvent {
  id: string; slug: string; title: string; description: string; created_at: string;
  closed_at: string | null; is_closed: boolean; chosen_option_id: number | null;
  time_options: ApiTimeOption[];
  /** Public: names + answers only (votes aligned with time_options; null = not answered). Never tokens. */
  participants: ApiParticipant[];
}
export interface ApiParticipant { id: number; name: string; votes: ('yes' | 'maybe' | 'no' | null)[] }
/** options = [{ id, date }], no time zone. */
export interface ApiEventResponse extends ApiEvent { options: { id: number; date: string }[]; url: string }

/** DB columns for a clean option. */
export const optData = (o: CleanEvent['timeOptions'][number]) => ({ date: toUtcDate(o.date) });

export const newSlug = () => randomBytes(16).toString('base64url'); // 128 bits → 22 chars
/** Admin link: token in the URL *fragment*, which browsers never send to the server (no logs/Referer). */
export const adminPath = (slug: string, token: string) => `/p/${slug}/admin#${token}`;

const publicSelect = {
  slug: true, title: true, description: true, createdAt: true, closedAt: true, chosenOptionId: true, // explicit allow-list: never adminTokenHash
  timeOptions: {
    select: { id: true, date: true, position: true },
    orderBy: [{ date: 'asc' }, { position: 'asc' }],
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
    time_options: ev.timeOptions.map((o) => ({ id: o.id, date: fromUtcDate(o.date), position: o.position })),
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
export async function createEvent(v: CleanEvent, idemKey?: string, locale = 'en'):
  Promise<{ slug: string; adminToken: string | null; replayed: boolean }> {
  const slug = newSlug();
  const adminToken = newToken();
  try {
    await prisma.$transaction(async (tx) => {
      const ev = await tx.event.create({
        data: {
          slug, locale, title: v.title, description: v.description, adminTokenHash: sha256Hex(adminToken),
          timeOptions: { create: v.timeOptions.map((o, i) => ({ ...optData(o), position: i })) },
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

/** Adds `options` ([{id, date}], no time zone) + `url`. */
export function withDesignShape(ev: ApiEvent): ApiEventResponse {
  return { ...ev, options: ev.time_options.map((o) => ({ id: o.id, date: o.date })), url: `/p/${ev.slug}` };
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
    if (unknown.length) throw new ApiError(400, ['Et eller flere datoforslag findes ikke (længere). Genindlæs siden.']);
    const keep = new Set(v.timeOptions.map((o) => o.id).filter((x): x is number => x !== undefined));
    const removing = existing.filter((o) => !keep.has(o.id));
    const voted = removing.filter((o) => o._count.votes > 0);
    if (voted.length && !confirmRemoveVoted) {
      throw new ApiError(409, ['Nogle af de fjernede datoforslag har svar. Bekræft for at slette dem.'],
        { voted_option_ids: voted.map((o) => o.id) });
    }
    if (removing.length) {
      const { chosenOptionId } = (await tx.event.findUnique({ where: { id: eventId }, select: { chosenOptionId: true } }))!;
      await tx.timeOption.deleteMany({ where: { id: { in: removing.map((o) => o.id) } } });
      // Deleting the chosen option clears the choice (FK SET NULL) → calendar entry changes too.
      if (chosenOptionId !== null && removing.some((o) => o.id === chosenOptionId)) {
        await tx.event.update({ where: { id: eventId }, data: { icsSequence: { increment: 1 }, chosenChangedAt: new Date() } });
      }
    }
    await tx.event.update({ where: { id: eventId }, data: { title: v.title, description: v.description } });
    for (const [i, o] of v.timeOptions.entries()) {
      if (o.id !== undefined) {
        const before = await tx.timeOption.update({ where: { id: o.id }, data: { position: i }, select: { date: true, chosenBy: { select: { id: true } } } });
        const moved = fromUtcDate(before.date) !== o.date;
        if (moved) {
          await tx.timeOption.update({ where: { id: o.id }, data: optData(o) });
          if (before.chosenBy) await tx.event.update({ where: { id: eventId }, data: { icsSequence: { increment: 1 }, chosenChangedAt: new Date() } });
        }
      }
      else await tx.timeOption.create({ data: { eventId, ...optData(o), position: i } });
    }
  });
}

export async function existingOptions(eventId: number) {
  return prisma.timeOption.findMany({ where: { eventId }, select: { id: true, date: true } });
}


/** Fields to set when the chosen time may change: bump SEQUENCE + LAST-MODIFIED only on a real change. */
async function chosenChange(eventId: number, next: number | null) {
  const cur = await prisma.event.findUnique({ where: { id: eventId }, select: { chosenOptionId: true } });
  return cur?.chosenOptionId === next ? {} : { icsSequence: { increment: 1 }, chosenChangedAt: new Date() };
}

export async function closeEvent(eventId: number, chosenOptionId: number | null) {
  if (chosenOptionId !== null) {
    const ok = await prisma.timeOption.count({ where: { id: chosenOptionId, eventId } });
    if (!ok) throw new ApiError(400, ['Den valgte dato findes ikke i afstemningen.']);
  }
  await prisma.event.update({ where: { id: eventId }, data: { closedAt: new Date(), chosenOptionId, ...(await chosenChange(eventId, chosenOptionId)) } });
}

export async function reopenEvent(eventId: number) {
  await prisma.event.update({ where: { id: eventId }, data: { closedAt: null, chosenOptionId: null, ...(await chosenChange(eventId, null)) } });
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

/** Pick / change / clear the final time independently of closing. */
export async function chooseOption(eventId: number, chosenOptionId: number | null) {
  if (chosenOptionId !== null) {
    const ok = await prisma.timeOption.count({ where: { id: chosenOptionId, eventId } });
    if (!ok) throw new ApiError(400, ['Den valgte dato findes ikke i afstemningen.']);
  }
  await prisma.event.update({ where: { id: eventId }, data: { chosenOptionId, ...(await chosenChange(eventId, chosenOptionId)) } });
}

/** Organizer removes a participant; votes cascade. */
export async function deleteParticipant(eventId: number, participantId: number) {
  const p = await prisma.participant.findFirst({ where: { id: participantId, eventId }, select: { editTokenHash: true } });
  const [, r] = await prisma.$transaction([
    prisma.deletedParticipant.createMany({ data: p ? [{ editTokenHash: p.editTokenHash, eventId }] : [], skipDuplicates: true }),
    prisma.participant.deleteMany({ where: { id: participantId, eventId } }),
  ]);
  if (!r.count) throw new ApiError(404, ['Deltageren findes ikke.']);
}

/**
 * Edit ONE option's date (design §31). `resetVotes` deletes its votes. 409 duplicate_option if another option has
 * that date; a changed date must not be in the past; moving the chosen option bumps the ICS SEQUENCE.
 */
export async function editOption(eventId: number, optionId: number, date: string, resetVotes: boolean, isPast: (d: string) => boolean) {
  return prisma.$transaction(async (tx) => {
    const o = await tx.timeOption.findFirst({ where: { id: optionId, eventId }, select: { date: true, chosenBy: { select: { id: true } } } });
    if (!o) throw new ApiError(404, ['Forslaget findes ikke (længere). Genindlæs siden.']);
    const dup = await tx.timeOption.count({ where: { eventId, id: { not: optionId }, date: toUtcDate(date) } });
    if (dup) throw new ApiError(409, ['Den dato findes allerede som et andet forslag.'], { code: 'duplicate_option' });
    const changed = fromUtcDate(o.date) !== date;
    if (changed && isPast(date)) throw new ApiError(400, ['Datoen ligger i fortiden.'], { code: 'past' });
    await tx.timeOption.update({ where: { id: optionId }, data: { date: toUtcDate(date) } });
    const reset = resetVotes ? (await tx.vote.deleteMany({ where: { timeOptionId: optionId } })).count : 0;
    if (changed && o.chosenBy) await tx.event.update({ where: { id: eventId }, data: { icsSequence: { increment: 1 }, chosenChangedAt: new Date() } });
    return { changed, reset };
  });
}

/** Organizer deletes the whole poll (options, participants, votes, idempotency keys cascade). */
export async function deleteEvent(eventId: number) {
  // Hard delete (cascade). Only an aggregate counter remains for the owner dashboard (PM 11 Oct).
  const r = await prisma.event.deleteMany({ where: { id: eventId } });
  if (!r.count) throw new ApiError(404, ['Afstemningen findes ikke.']);
  await bumpStat('polls_deleted');
}
