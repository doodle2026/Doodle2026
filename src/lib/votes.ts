import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { ApiError } from './events';
import { newToken, openForKey, sealForKey, sha256Hex, TOKEN_RE } from './tokens';
import { isBlank, nameKey, normalizeName, textLength } from './validate';

export const NAME_MAX = 100;
export type VoteValue = 'yes' | 'maybe' | 'no';
export interface CleanVote { name: string; nameKey: string; votes: Map<number, VoteValue> }

// Strip invisible spacers, but keep ZWJ/ZWNJ (U+200C/D): they are part of emoji sequences and some scripts.
/** Display name (shared normalizer in validate.ts: invisible chars stripped, emoji ZWJ kept). */
export const cleanName = normalizeName;
/** Case-insensitive, invisible-insensitive uniqueness key ("Jan" = "jan" = "ＪＡＮ" = "\u200DJan"). */
export const participantNameKey = nameKey;

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/**
 * Body: { name: string, votes: [{ option_id: number, value: 'yes'|'maybe'|'no'|null }] }.
 * Missing options = not answered (null). At least one non-null answer. Option ids checked against the poll.
 */
export function validateVote(body: unknown, optionIds: Set<number>): { errors: string[]; value: CleanVote | null } {
  if (!isObj(body)) return { errors: ['Forespørgslen skal være et JSON-objekt.'], value: null };
  const errors: string[] = [];
  let name = '';
  if (typeof body.name !== 'string' || isBlank(body.name)) errors.push('Skriv dit navn, så de andre kan se, hvem der har svaret.');
  else {
    name = cleanName(body.name);
    const n = textLength(name);
    if (n > NAME_MAX) errors.push(`Navnet er ${n - NAME_MAX} tegn for langt (højst ${NAME_MAX}).`);
  }
  const votes = new Map<number, VoteValue>();
  if (!Array.isArray(body.votes)) errors.push('votes skal være en liste.');
  else if (body.votes.length > 100) errors.push('For mange svar.');
  else {
    const seen = new Set<number>();
    body.votes.forEach((v, i) => {
      if (!isObj(v)) { errors.push(`Svar ${i + 1}: ugyldigt format.`); return; }
      const id = v.option_id;
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || !optionIds.has(id)) { errors.push(`Svar ${i + 1}: datoforslaget findes ikke (længere). Genindlæs siden.`); return; }
      if (seen.has(id)) { errors.push(`Svar ${i + 1}: datoforslaget er angivet to gange.`); return; }
      seen.add(id);
      if (v.value === null || v.value === undefined) return;
      if (v.value !== 'yes' && v.value !== 'maybe' && v.value !== 'no') { errors.push(`Svar ${i + 1}: ugyldig værdi.`); return; }
      votes.set(id, v.value);
    });
    if (!errors.length && votes.size === 0) errors.push('Svar på mindst én dato (ja, måske eller nej).');
  }
  if (errors.length) return { errors, value: null };
  return { errors: [], value: { name, nameKey: participantNameKey(name), votes } };
}

export async function eventForVoting(slug: string) {
  return prisma.event.findUnique({ where: { slug }, select: { id: true, closedAt: true, timeOptions: { select: { id: true } } } });
}

const closedError = () => new ApiError(423, ['Afstemningen er lukket. Svar kan ikke længere gives eller ændres.'], { code: 'closed' });
const dupName = (name: string) => new ApiError(409, [`"${name}" har allerede svaret. Tilføj f.eks. et efternavn.`], { code: 'name_taken' });
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export async function findVoteReplay(idemKey: string) {
  const hit = await prisma.voteIdempotencyKey.findUnique({
    where: { keyHash: sha256Hex(idemKey) },
    select: { participantId: true, editTokenEnc: true, participant: { select: { nameKey: true, votes: { select: { timeOptionId: true, value: true } } } } },
  });
  return hit ? {
    participantId: hit.participantId, editToken: openForKey(idemKey, hit.editTokenEnc),
    stored: { nameKey: hit.participant.nameKey, votes: new Map(hit.participant.votes.map((v) => [v.timeOptionId, v.value as VoteValue])) },
  } : null;
}

/** A replay must carry the same answers as the original; otherwise the key was reused for a different request (V2). */
export function sameVote(a: { nameKey: string; votes: Map<number, VoteValue> }, b: CleanVote): boolean {
  if (a.nameKey !== b.nameKey || a.votes.size !== b.votes.size) return false;
  for (const [k, v] of b.votes) if (a.votes.get(k) !== v) return false;
  return true;
}

/** Create participant + votes atomically. Closed check inside the transaction (row lock on the event). */
export async function createParticipant(eventId: number, v: CleanVote, idemKey?: string) {
  const editToken = newToken();
  try {
    const p = await prisma.$transaction(async (tx) => {
      await lockOpenEvent(tx, eventId);
      const p = await tx.participant.create({ data: { eventId, name: v.name, nameKey: v.nameKey, editTokenHash: sha256Hex(editToken) } });
      await tx.vote.createMany({ data: [...v.votes].map(([timeOptionId, value]) => ({ participantId: p.id, timeOptionId, value })) });
      if (idemKey) await tx.voteIdempotencyKey.create({ data: { keyHash: sha256Hex(idemKey), participantId: p.id, editTokenEnc: sealForKey(idemKey, editToken) } });
      return p;
    });
    return { participantId: p.id, editToken, replayed: false };
  } catch (e) {
    if (isUnique(e) && idemKey) {
      const r = await findVoteReplay(idemKey);
      if (r && sameVote(r.stored, v)) return { participantId: r.participantId, editToken: r.editToken, replayed: true };
      if (r) throw new ApiError(422, ['Idempotency-Key er allerede brugt til andre svar. Prøv at gemme igen.'], { code: 'idempotency_mismatch' });
    }
    if (isUnique(e)) throw dupName(v.name);
    throw e;
  }
}

async function lockOpenEvent(tx: Prisma.TransactionClient, eventId: number) {
  // SELECT … FOR UPDATE serialises against close/reopen; unqualified table name → respects ?schema=.
  const rows = await tx.$queryRaw<{ closed_at: Date | null }[]>`SELECT closed_at FROM events WHERE id = ${eventId} FOR UPDATE`;
  if (!rows.length) throw new ApiError(404, ['Afstemningen findes ikke.']);
  if (rows[0].closed_at) throw closedError();
}

/** Participant owning `token` in poll `eventId`, or null. 256-bit token → lookup by its SHA-256 is safe. */
export async function participantByToken(eventId: number, token: string | null) {
  if (!token || !TOKEN_RE.test(token)) return null;
  const p = await prisma.participant.findUnique({
    where: { editTokenHash: sha256Hex(token) },
    select: { id: true, eventId: true, name: true, votes: { select: { timeOptionId: true, value: true } } },
  });
  return p && p.eventId === eventId ? p : null;
}

export async function updateParticipant(eventId: number, participantId: number, v: CleanVote) {
  try {
    await prisma.$transaction(async (tx) => {
      await lockOpenEvent(tx, eventId);
      await tx.participant.update({ where: { id: participantId }, data: { name: v.name, nameKey: v.nameKey } });
      await tx.vote.deleteMany({ where: { participantId } });
      await tx.vote.createMany({ data: [...v.votes].map(([timeOptionId, value]) => ({ participantId, timeOptionId, value })) });
    });
  } catch (e) {
    if (isUnique(e)) throw dupName(v.name);
    throw e;
  }
}

