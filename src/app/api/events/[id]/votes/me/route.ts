import { NextResponse } from 'next/server';
import { jsonError, readJson } from '@/lib/http';
import { rateLimit } from '@/lib/ratelimit';
import { LIMITS } from '@/lib/validate';
import { eventForVoting, participantByToken, pastVoteErrors, updateParticipant, validateVote, type VoteValue } from '@/lib/votes';
import { editBearer, guarded, publicEvent } from '@/lib/votes-api';
import { ApiError } from '@/lib/events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };

async function auth(req: Request, slug: string) {
  const ev = await eventForVoting(slug);
  if (!ev) throw new ApiError(404, ['Afstemningen findes ikke.']);
  const token = editBearer(req);
  if (!token) throw new ApiError(401, ['Mangler redigeringslink.']);
  const p = await participantByToken(ev.id, token);
  if (!p) throw new ApiError(403, ['Redigeringslinket er ugyldigt. Du kan stadig se afstemningen, men ikke ændre svarene.']);
  return { ev, p };
}

/** Own answers (Bearer edit token). */
export async function GET(req: Request, { params }: Ctx) {
  return guarded('GET votes/me', async () => {
    const { ev, p } = await auth(req, (await params).id);
    return NextResponse.json({
      participant_id: p.id, name: p.name, is_closed: ev.closedAt !== null,
      votes: p.votes.map((v) => ({ option_id: v.timeOptionId, value: v.value })),
    });
  });
}

/** Replace own name + answers. Same validation as POST; 423 when closed; 409 if the new name is taken. */
export async function PUT(req: Request, { params }: Ctx) {
  return guarded('PUT votes/me', async () => {
    const limited = rateLimit(req); if (limited) return limited;
    const body = await readJson(req, LIMITS.bodyBytes);
    if ('response' in body) return body.response;
    const slug = (await params).id;
    const { ev, p } = await auth(req, slug);
    if (ev.closedAt) throw new ApiError(423, ['Afstemningen er lukket. Svar kan ikke længere gives eller ændres.'], { code: 'closed' });
    const { errors, value } = validateVote(body.data, new Set(ev.timeOptions.map((o) => o.id)));
    if (errors.length || !value) return jsonError(400, errors);
    const past = pastVoteErrors(value, ev.timeOptions, new Map(p.votes.map((x) => [x.timeOptionId, x.value as VoteValue])));
    if (past.length) return jsonError(400, past);
    await updateParticipant(ev.id, p.id, value);
    return NextResponse.json({ participant_id: p.id, event: await publicEvent(slug) });
  });
}
