import { NextResponse } from 'next/server';
import { jsonError, readJson } from '@/lib/http';
import { rateLimit } from '@/lib/ratelimit';
import { IDEMPOTENCY_RE, LIMITS } from '@/lib/validate';
import { claimInvite } from '@/lib/invitations';
import { createParticipant, eventForVoting, findVoteReplay, sameVote, validateVote } from '@/lib/votes';
import { editPath, guarded, publicEvent } from '@/lib/votes-api';
import { ApiError } from '@/lib/events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Vote: { name, votes: [{ option_id, value: 'yes'|'maybe'|'no'|null }] } → 201 { participant_id, edit_token, edit_url, event }.
 * The edit token is returned only here (and on idempotent replay with the same Idempotency-Key).
 * 423 if the poll is closed, 409 if the name is taken (case-insensitive).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded('POST votes', async () => {
    const limited = rateLimit(req); if (limited) return limited;
    const body = await readJson(req, LIMITS.bodyBytes);
    if ('response' in body) return body.response;
    const { id: slug } = await params;
    const tz = new URL(req.url).searchParams.get('tz');
    const idemKey = req.headers.get('idempotency-key') ?? undefined;
    if (idemKey !== undefined && !IDEMPOTENCY_RE.test(idemKey)) return jsonError(400, ['Ugyldig Idempotency-Key (16-100 tegn: A-Z, a-z, 0-9, _ eller -).']);
    const ev = await eventForVoting(slug);
    if (!ev) return jsonError(404, ['Afstemningen findes ikke.']);
    const respond = async (participantId: number, token: string | null, status: 200 | 201) => NextResponse.json({
      participant_id: participantId,
      ...(token ? { edit_token: token, edit_url: editPath(slug, token) } : {}),
      event: await publicEvent(slug, tz),
    }, { status, headers: status === 200 ? { 'Idempotent-Replayed': 'true' } : {} });
    const { errors, value } = validateVote(body.data, new Set(ev.timeOptions.map((o) => o.id)));
    if (idemKey) {
      const hit = await findVoteReplay(idemKey);
      if (hit) {
        // Same key + same answers → replay. Same key + different answers → reject instead of silently
        // returning the old answers (root cause of V2: "Måske" came back as the earlier "Nej").
        if (!value || !sameVote(hit.stored, value)) {
          throw new ApiError(422, ['Idempotency-Key er allerede brugt til andre svar. Prøv at gemme igen.'], { code: 'idempotency_mismatch' });
        }
        return respond(hit.participantId, hit.editToken, 200);
      }
    }
    if (ev.closedAt) throw new ApiError(423, ['Afstemningen er lukket. Svar kan ikke længere gives eller ændres.'], { code: 'closed' });
    if (errors.length || !value) return jsonError(400, errors);
    const r = await createParticipant(ev.id, value, idemKey);
    // Step 5: answer via a personal link → mark that invitee as answered (best effort; never blocks the vote).
    if (!r.replayed) await claimInvite(ev.id, req.headers.get('x-invite-token'), r.participantId).catch(() => false);
    return respond(r.participantId, r.editToken, r.replayed ? 200 : 201);
  });
}
