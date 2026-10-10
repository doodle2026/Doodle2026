/**
 * Step 4 – invitation mails (server). Rules (docs/EMAIL.md):
 * organizer only (admin token, checked by the route) · ≤ 50 recipients per send, ≤ 200 per poll ·
 * per-IP hourly brake (route) + per-poll hourly cap + global daily/monthly quota (Resend Free) reserved atomically ·
 * only the public /p/<id> link · suppression (hashed) checked before every send · personal message ≤ 1000 graphemes ·
 * reminders manual, ≤ 1 per 24 h and 3 per poll, none to closed polls, to all non-unsubscribed, non-bounced invitees ·
 * addresses deleted with the poll (cascade) or 90 days after close (cleanup()).
 */
import { prisma } from './db';
import { fromUtcDate } from './dates';
import { ApiError } from './events';
import { createHmac } from 'node:crypto';
import { sha256Hex, TOKEN_RE } from './tokens';
import { graphemes, MAX_PER_POLL, MAX_PER_SEND, MESSAGE_MAX, normEmail, parseRecipients, type Recipient } from './recipients';
import { mailer, planInvitations, planReminders, reminderBlock, sanitizeDisplayName, REMINDER_MAX, REMINDER_GAP_MS, type PollForEmail } from './email';

export const POLL_HOURLY_MAX = Number(process.env.EMAIL_POLL_HOURLY_MAX || 100);
export const DAILY_QUOTA = () => Number(process.env.EMAIL_DAILY_QUOTA || 100);
export const MONTHLY_QUOTA = () => Number(process.env.EMAIL_MONTHLY_QUOTA || 3000);
export const RETENTION_DAYS = 90;
export const ABUSE_BLOCK_AFTER = 2;

const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
/** Suppression key: SHA-256 of the normalized address (optionally peppered). The address itself is never stored there. */
export const emailHash = (e: string) => sha256Hex(`${process.env.EMAIL_HASH_PEPPER ?? ''}moedetid-email-v1:${normEmail(e)}`);
/**
 * Footer token (unsubscribe / report abuse) = HMAC(EMAIL_LINK_SECRET, invitation id): stable across the
 * invitation and all reminders, so old mails' unsubscribe links keep working. Only SHA-256(token) is stored.
 */
export function linkSecret(): string {
  const s = process.env.EMAIL_LINK_SECRET;
  if (s && s.length >= 32) return s;
  if ((process.env.EMAIL_MODE ?? 'log').toLowerCase() === 'send') throw new ApiError(503, ['Mail er ikke sat op på serveren.'], { code: 'email_config' });
  return 'dev-only-email-link-secret-not-for-production';
}
export const linkTokenFor = (invitationId: number) => createHmac('sha256', linkSecret()).update(`moedetid-inv-link-v1:${invitationId}`).digest('base64url');
/** Step 5 personal link token: HMAC over (id, generation). Resend/revoke bump the generation → old link dies. */
export const inviteTokenFor = (invitationId: number, gen: number) => createHmac('sha256', linkSecret()).update(`moedetid-invite-v1:${invitationId}:${gen}`).digest('base64url');
const pollScope = (eventId: number) => `poll:${eventId}`;

/** Clean the personal message: plain text, keep newlines, drop other control/bidi chars, ≤ 1000 graphemes. */
export function cleanMessage(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return '';
  if (typeof raw !== 'string') throw new ApiError(400, ['Beskeden skal være tekst.']);
  const s = raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F\u202A-\u202E\u2066-\u2069\u200B\uFEFF]/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const n = graphemes(s);
  if (n > MESSAGE_MAX) throw new ApiError(400, [`Beskeden er ${n - MESSAGE_MAX} tegn for lang.`], { code: 'message_too_long' });
  if (/\/p\/[A-Za-z0-9_-]+\/admin|[#?&](?:edit|inv|invite)=/i.test(s)) throw new ApiError(400, ['Beskeden må ikke indeholde admin- eller redigeringslinks.'], { code: 'secret_link' });
  return s;
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Atomically reserve `n` mails of the global quota (advisory lock serializes concurrent sends).
 * Returns false (nothing reserved) if the day or month would go over.
 */
export async function reserveQuota(n: number, now = new Date(), limits = { day: DAILY_QUOTA(), month: MONTHLY_QUOTA() }): Promise<boolean> {
  if (n <= 0) return true;
  const day = utcDay(now), month = day.slice(0, 7);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(724001)`;
    const [d] = await tx.$queryRaw<{ c: number }[]>`SELECT COALESCE(SUM(count),0)::int AS c FROM email_quota WHERE day = ${day}`;
    const [m] = await tx.$queryRaw<{ c: number }[]>`SELECT COALESCE(SUM(count),0)::int AS c FROM email_quota WHERE day LIKE ${month + '-%'}`;
    if (d.c + n > limits.day || m.c + n > limits.month) return false;
    await tx.$executeRaw`INSERT INTO email_quota (day, count) VALUES (${day}, ${n}) ON CONFLICT (day) DO UPDATE SET count = email_quota.count + ${n}`;
    return true;
  });
}
export async function releaseQuota(n: number, now = new Date()) {
  if (n > 0) await prisma.$executeRaw`UPDATE email_quota SET count = GREATEST(0, count - ${n}) WHERE day = ${utcDay(now)}`;
}

async function suppressedSet(eventId: number, emails: string[]): Promise<Set<string>> {
  if (!emails.length) return new Set();
  const byHash = new Map(emails.map((e) => [emailHash(e), e]));
  const rows = await prisma.emailSuppression.findMany({ where: { emailHash: { in: [...byHash.keys()] }, scope: { in: ['all', pollScope(eventId)] } }, select: { emailHash: true } });
  return new Set(rows.map((r) => byHash.get(r.emailHash)!));
}

async function pollForEmail(eventId: number) {
  const ev = await prisma.event.findUnique({ where: { id: eventId }, include: { timeOptions: { orderBy: [{ date: 'asc' }] } } });
  if (!ev) throw new ApiError(404, ['Afstemningen findes ikke.']);
  const p: PollForEmail = {
    slug: ev.slug, title: ev.title, description: ev.description, isClosed: ev.closedAt !== null,
    organizerName: ev.organizerName || 'Arrangøren', organizerFromName: ev.organizerName ?? undefined,
    options: ev.timeOptions.map((o) => ({ date: fromUtcDate(o.date) })),
    remindersSent: ev.remindersSent, lastReminderAt: ev.lastReminderAt, trackingEnabled: ev.inviteTracking,
  };
  return { ev, p };
}

type Planned = { to: string; idempotencyKey?: string } & Parameters<ReturnType<typeof mailer>['send']>[0];
/** Send planned messages (batch), record provider ids/status per invitation; releases quota for failures. */
async function deliver(eventId: number, msgs: Planned[], byEmail: Map<string, number>) {
  const results = await mailer().sendBatch(msgs);
  let failed = 0;
  await prisma.$transaction(results.map((r, i) => {
    const id = byEmail.get(normEmail(msgs[i].to))!;
    if (!r.ok) failed++;
    return prisma.invitation.update({
      where: { id },
      data: r.ok
        ? { delivery: 'sent', reason: null, providerId: r.id ?? null, lastEventAt: new Date() }
        : { delivery: 'failed', reason: r.error === 'config' ? 'Mail er ikke sat op på serveren' : 'Kunne ikke sende – prøv igen senere', lastEventAt: new Date() },
    });
  }));
  await releaseQuota(failed);
  return { sent: results.length - failed, failed };
}

export interface InviteInput { recipients: unknown; message?: unknown; organizer_name?: unknown; track?: unknown }

export async function sendInvitations(eventId: number, body: InviteInput) {
  const { ev, p } = await pollForEmail(eventId);
  if (p.isClosed) throw new ApiError(409, ['Afstemningen er lukket – der kan ikke sendes invitationer.'], { code: 'closed' });
  if (ev.mailBlockedAt) throw new ApiError(403, ['Mails er stoppet for denne afstemning efter rapporter om misbrug.'], { code: 'mail_blocked' });
  const raw = body.recipients;
  if (!(typeof raw === 'string' || (Array.isArray(raw) && raw.every((x) => typeof x === 'string')))) throw new ApiError(400, ['Angiv modtagere.'], { code: 'recipients_required' });
  const message = cleanMessage(body.message);
  let organizerName = ev.organizerName ?? '';
  if (body.organizer_name !== undefined && body.organizer_name !== null) {
    if (typeof body.organizer_name !== 'string') throw new ApiError(400, ['Ugyldigt navn.']);
    organizerName = sanitizeDisplayName(body.organizer_name);
  }

  const existing = await prisma.invitation.findMany({ where: { eventId }, select: { email: true } });
  const parsed = parseRecipients(raw as string | string[], existing.map((e) => e.email));
  if (parsed.invalid.length) throw new ApiError(400, [`Ugyldige adresser: ${parsed.invalid.slice(0, 5).join(', ')}${parsed.invalid.length > 5 ? ' …' : ''}`], { code: 'invalid_recipients', invalid: parsed.invalid });
  if (!parsed.valid.length) throw new ApiError(400, ['Ingen nye modtagere.'], { code: 'no_new_recipients', ...parsed });
  if (parsed.valid.length > MAX_PER_SEND) throw new ApiError(400, [`Højst ${MAX_PER_SEND} modtagere pr. afsendelse.`], { code: 'too_many_per_send' });
  if (existing.length + parsed.valid.length > MAX_PER_POLL) throw new ApiError(400, [`Højst ${MAX_PER_POLL} inviterede pr. afstemning (${MAX_PER_POLL - existing.length} tilbage).`], { code: 'too_many_per_poll' });
  const lastHour = await prisma.invitation.count({ where: { eventId, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
  if (lastHour + parsed.valid.length > POLL_HOURLY_MAX) throw new ApiError(429, ['For mange invitationer på kort tid. Prøv igen om en time.'], { code: 'poll_hourly_limit' });

  const suppressed = await suppressedSet(eventId, parsed.valid.map((r) => r.email));
  const toSend = parsed.valid.filter((r) => !suppressed.has(r.email));
  if (!(await reserveQuota(toSend.length))) throw new ApiError(429, ['Dagens mailkvote er brugt op. Prøv igen i morgen.'], { code: 'quota' });

  // Persist first (status "queued"), with a fresh footer token per recipient; suppressed ones are stored as "unsub".
  const tokens = new Map<string, string>(), invTokens = new Map<string, string>();
  const track = body.track === true;
  linkSecret(); // fail early (503) when send mode lacks EMAIL_LINK_SECRET
  try {
    await prisma.$transaction(async (tx) => {
      if (organizerName !== (ev.organizerName ?? '') || (track && !ev.inviteTracking)) {
        await tx.event.update({ where: { id: eventId }, data: { organizerName: organizerName || null, ...(track ? { inviteTracking: true } : {}) } });
      }
      for (const r of parsed.valid) {
        const row = await tx.invitation.create({ data: { eventId, email: r.email, name: r.name ?? null, linkTokenHash: sha256Hex(`pending:${eventId}:${r.email}:${Math.random()}`), delivery: suppressed.has(r.email) ? 'unsub' : 'queued' } });
        const t = linkTokenFor(row.id); tokens.set(r.email, t);
        const it = track ? inviteTokenFor(row.id, 1) : null;
        if (it) invTokens.set(r.email, it);
        await tx.invitation.update({ where: { id: row.id }, data: { linkTokenHash: sha256Hex(t), ...(it ? { inviteGen: 1, inviteTokenHash: sha256Hex(it) } : {}) } });
      }
    });
  } catch (e) { await releaseQuota(toSend.length); if ((e as { code?: string }).code === 'P2002') throw new ApiError(409, ['Nogle modtagere er allerede inviteret.'], { code: 'already_invited' }); throw e; }

  p.organizerFromName = organizerName || undefined;
  p.organizerName = organizerName || 'Arrangøren';
  const plan = planInvitations(p, toSend.map((r) => ({ email: r.email, name: r.name, linkToken: tokens.get(r.email)!, inviteToken: invTokens.get(r.email) })), { appUrl: appUrl(), personalMessage: message || undefined });
  const ids = new Map((await prisma.invitation.findMany({ where: { eventId, email: { in: toSend.map((r) => r.email) } }, select: { id: true, email: true } })).map((r) => [r.email, r.id]));
  const res = await deliver(eventId, plan.messages, ids);
  return { ...res, suppressed: suppressed.size, duplicates: parsed.duplicates, already_invited: parsed.alreadyInvited };
}

export async function sendReminder(eventId: number) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`; // serialize reminder rounds per poll
    const { ev, p } = await pollForEmail(eventId);
    if (ev.mailBlockedAt) throw new ApiError(403, ['Mails er stoppet for denne afstemning efter rapporter om misbrug.'], { code: 'mail_blocked' });
    const block = reminderBlock(p);
    if (block === 'closed') throw new ApiError(409, ['Afstemningen er lukket – der sendes ikke påmindelser.'], { code: 'closed' });
    if (block === 'limit_reached') throw new ApiError(409, [`Du har brugt alle ${REMINDER_MAX} påmindelser til denne afstemning.`], { code: 'reminder_limit' });
    if (block === 'too_soon') throw new ApiError(429, ['Højst én påmindelse pr. døgn.'], { code: 'reminder_too_soon', next_allowed_at: new Date(p.lastReminderAt!.getTime() + REMINDER_GAP_MS).toISOString() });
    // Tracked invitees (personal link): only those who haven't answered and whose link isn't revoked.
    // Untracked invitees: all non-unsubscribed, non-bounced (we can't know who answered) – design §30.6/§43.
    const inv = (await tx.invitation.findMany({ where: { eventId, delivery: { notIn: ['unsub', 'bounced'] } } }))
      .filter((i) => i.inviteGen === null || (i.participantId === null && i.revokedAt === null));
    const suppressed = await suppressedSet(eventId, inv.map((i) => i.email));
    const tokens = new Map(inv.map((i) => [i.email, linkTokenFor(i.id)]));
    const plan = planReminders(p, inv.map((i) => ({ email: i.email, name: i.name ?? undefined, linkToken: tokens.get(i.email)!, inviteToken: i.inviteGen ? inviteTokenFor(i.id, i.inviteGen) : undefined, unsubscribedAt: suppressed.has(i.email) ? new Date() : null })), { appUrl: appUrl() });
    if (!plan.messages.length) throw new ApiError(400, ['Der er ingen modtagere til en påmindelse.'], { code: 'no_recipients' });
    if (!(await reserveQuota(plan.messages.length))) throw new ApiError(429, ['Dagens mailkvote er brugt op. Prøv igen i morgen.'], { code: 'quota' });
    await tx.event.update({ where: { id: eventId }, data: { remindersSent: { increment: 1 }, lastReminderAt: new Date() } });
    for (const e of suppressed) await tx.invitation.update({ where: { eventId_email: { eventId, email: e } }, data: { delivery: 'unsub', lastEventAt: new Date() } });
    return { plan, ids: new Map(inv.map((i) => [i.email, i.id])) };
  }).then(async ({ plan, ids }) => {
    const r = await deliver(eventId, plan.messages.map((m) => ({ ...m, idempotencyKey: `${m.idempotencyKey}:${Date.now() >> 20}` })), ids);
    return { ...r, recipients: plan.messages.length };
  });
}

export async function listInvitations(eventId: number) {
  const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { closedAt: true, remindersSent: true, lastReminderAt: true, organizerName: true, mailBlockedAt: true, inviteTracking: true } });
  if (!ev) throw new ApiError(404, ['Afstemningen findes ikke.']);
  const rows = await prisma.invitation.findMany({ where: { eventId }, orderBy: { createdAt: 'asc' }, select: {
    email: true, name: true, delivery: true, reason: true, lastEventAt: true, inviteGen: true, revokedAt: true, participantId: true, linkedManually: true,
    participant: { select: { name: true } } } });
  const remindable = (r: typeof rows[number]) => r.delivery !== 'unsub' && r.delivery !== 'bounced' && (r.inviteGen === null || (r.participantId === null && r.revokedAt === null));
  const recipients = rows.filter(remindable).length;
  const linked = new Set(rows.map((r) => r.participantId).filter((x): x is number => x !== null));
  const publicAnswers = ev.inviteTracking
    ? (await prisma.participant.findMany({ where: { eventId }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } })).filter((p) => !linked.has(p.id))
    : [];
  const next = ev.lastReminderAt ? new Date(ev.lastReminderAt.getTime() + REMINDER_GAP_MS) : null;
  return {
    invitees: rows.map((r) => ({
      email: r.email, name: r.name, delivery: r.delivery, reason: r.reason, updated_at: r.lastEventAt.toISOString(),
      // Step 5 "Svar" axis (only for personal links): invited | answered | revoked.
      response: r.inviteGen === null ? null : r.participantId !== null ? 'answered' : r.revokedAt ? 'revoked' : 'invited',
      linked_from: r.linkedManually && r.participant ? r.participant.name : null,
    })),
    tracking: ev.inviteTracking,
    public_answers: publicAnswers,
    organizer_name: ev.organizerName ?? '',
    limits: { per_send: MAX_PER_SEND, per_poll: MAX_PER_POLL, used: rows.length, message_max: MESSAGE_MAX },
    reminder: { used: ev.remindersSent, max: REMINDER_MAX, next_allowed_at: next && next > new Date() ? next.toISOString() : null, recipient_count: recipients, answered_count: rows.filter((r) => r.participantId !== null).length, closed: ev.closedAt !== null },
    mail_blocked: ev.mailBlockedAt !== null,
  };
}

// ---- Unsubscribe / abuse (token from the mail footer) ---------------------------------------------
async function byToken(token: string) {
  if (!TOKEN_RE.test(token)) return null;
  return prisma.invitation.findUnique({ where: { linkTokenHash: sha256Hex(token) }, include: { event: { select: { id: true, slug: true, title: true } } } });
}
export async function linkInfo(token: string) {
  const i = await byToken(token);
  if (!i) return null;
  const s = await prisma.emailSuppression.findMany({ where: { emailHash: emailHash(i.email), scope: { in: ['all', pollScope(i.eventId)] } }, select: { scope: true } });
  return { email: i.email, title: i.event.title, slug: i.event.slug, poll_unsubscribed: s.some((x) => x.scope !== 'all'), all_unsubscribed: s.some((x) => x.scope === 'all') };
}
export async function setSubscription(token: string, scope: 'poll' | 'all', unsubscribe: boolean) {
  const i = await byToken(token);
  if (!i) throw new ApiError(404, ['Linket er ugyldigt eller udløbet.']);
  const key = { emailHash: emailHash(i.email), scope: scope === 'all' ? 'all' : pollScope(i.eventId) };
  if (unsubscribe) await prisma.emailSuppression.upsert({ where: { emailHash_scope: key }, create: key, update: {} });
  else await prisma.emailSuppression.deleteMany({ where: key });
  // Organizer sees only "Afmeldt" (never which scope or why).
  const still = await prisma.emailSuppression.count({ where: { emailHash: key.emailHash, scope: { in: ['all', pollScope(i.eventId)] } } });
  await prisma.invitation.updateMany({ where: { id: i.id, delivery: { not: 'bounced' } }, data: still ? { delivery: 'unsub', reason: null, lastEventAt: new Date() } : { delivery: 'sent', lastEventAt: new Date() } });
  return linkInfo(token);
}
export const ABUSE_REASONS = ['spam', 'unknown_sender', 'phishing', 'other'] as const;
export async function reportAbuse(token: string, reason: unknown, details: unknown, alsoUnsubscribe: unknown) {
  const i = await byToken(token);
  if (!i) throw new ApiError(404, ['Linket er ugyldigt eller udløbet.']);
  if (typeof reason !== 'string' || !(ABUSE_REASONS as readonly string[]).includes(reason)) throw new ApiError(400, ['Vælg en årsag.'], { code: 'reason_required' });
  const d = typeof details === 'string' ? details.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim().slice(0, 1000) : '';
  await prisma.abuseReport.create({ data: { eventId: i.eventId, reason, details: d || null } });
  const n = await prisma.abuseReport.count({ where: { eventId: i.eventId } });
  if (n >= ABUSE_BLOCK_AFTER) await prisma.event.updateMany({ where: { id: i.eventId, mailBlockedAt: null }, data: { mailBlockedAt: new Date() } });
  if (alsoUnsubscribe !== false) await setSubscription(token, 'poll', true);
  return { ok: true };
}

// ---- Resend webhooks -------------------------------------------------------------------------------
const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, failed: 2, bounced: 4, unsub: 5 };
export async function applyWebhook(evt: { type?: unknown; data?: { email_id?: unknown; bounce?: { type?: unknown } } }) {
  const id = typeof evt.data?.email_id === 'string' ? evt.data.email_id : null;
  const type = typeof evt.type === 'string' ? evt.type : '';
  if (!id) return { ignored: true };
  const i = await prisma.invitation.findUnique({ where: { providerId: id } });
  if (!i) return { ignored: true };
  let next: { delivery: string; reason: string | null } | null = null;
  if (type === 'email.sent') next = { delivery: 'sent', reason: null };
  else if (type === 'email.delivered') next = { delivery: 'delivered', reason: null };
  else if (type === 'email.delivery_delayed') next = { delivery: 'failed', reason: 'Midlertidig fejl hos modtagerens server – prøver igen' };
  else if (type === 'email.failed') next = { delivery: 'failed', reason: 'Kunne ikke sendes' };
  else if (type === 'email.bounced') next = { delivery: 'bounced', reason: 'Adressen findes ikke (hard bounce)' };
  else if (type === 'email.complained') next = { delivery: 'bounced', reason: 'Markeret som spam af modtageren' };
  if (!next) return { ignored: true };
  // Never downgrade (e.g. a late "delivered" after "bounced"); delivered may replace a temporary failure.
  if (RANK[next.delivery] < RANK[i.delivery] && !(i.delivery === 'failed' && next.delivery === 'delivered')) return { ignored: true };
  await prisma.invitation.update({ where: { id: i.id }, data: { ...next, lastEventAt: new Date() } });
  if (type === 'email.complained' || (type === 'email.bounced' && evt.data?.bounce?.type !== 'Transient')) {
    const key = { emailHash: emailHash(i.email), scope: 'all' };
    await prisma.emailSuppression.upsert({ where: { emailHash_scope: key }, create: key, update: {} });
  }
  return { updated: true };
}

// ---- Cleanup (cron) ----------------------------------------------------------------------------------
/** Idempotent: delete invitee addresses of polls closed > 90 days ago; prune old quota rows. */
export async function cleanup(now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86400_000);
  const inv = await prisma.invitation.deleteMany({ where: { event: { closedAt: { lt: cutoff } } } });
  const q = await prisma.emailQuota.deleteMany({ where: { day: { lt: utcDay(new Date(now.getTime() - 62 * 86400_000)) } } });
  return { invitations_deleted: inv.count, quota_rows_deleted: q.count };
}
export type { Recipient };

/** Organizer preview of the real invitation mail (sample recipient, dummy footer token). */
export async function previewInvitation(eventId: number, body: { message?: unknown; organizer_name?: unknown }) {
  const { p } = await pollForEmail(eventId);
  const message = cleanMessage(body.message);
  const name = typeof body.organizer_name === 'string' ? sanitizeDisplayName(body.organizer_name) : (p.organizerFromName ?? '');
  p.organizerName = name || 'Arrangøren'; p.organizerFromName = name || undefined;
  const plan = planInvitations({ ...p, isClosed: false }, [{ email: 'modtager@example.com', linkToken: 'x'.repeat(43) }], { appUrl: appUrl(), personalMessage: message || undefined });
  const m = plan.messages[0];
  return { subject: m.subject, html: m.html, from_name: m.fromName };
}

// ---- Step 5: personal invite links ------------------------------------------------------------------
async function invitationFor(eventId: number, email: unknown) {
  if (typeof email !== 'string') throw new ApiError(400, ['Angiv en modtager.']);
  const i = await prisma.invitation.findUnique({ where: { eventId_email: { eventId, email: normEmail(email) } } });
  if (!i) throw new ApiError(404, ['Modtageren er ikke inviteret.']);
  return i;
}

/**
 * Resend the personal link. Only SHA-256 of the token is stored and the token is derived from a generation
 * counter, so a resend ISSUES A NEW TOKEN (old link stops working) – deliberate deviation from "same token".
 * Counts against the mail quota, not as a reminder.
 */
export async function resendInvite(eventId: number, email: unknown) {
  const i = await invitationFor(eventId, email);
  const { ev, p } = await pollForEmail(eventId);
  if (p.isClosed) throw new ApiError(409, ['Afstemningen er lukket.'], { code: 'closed' });
  if (ev.mailBlockedAt) throw new ApiError(403, ['Mails er stoppet for denne afstemning efter rapporter om misbrug.'], { code: 'mail_blocked' });
  if (i.delivery === 'bounced' || i.delivery === 'unsub') throw new ApiError(409, ['Modtageren kan ikke få mails (afvist eller afmeldt).'], { code: 'not_mailable' });
  if ((await suppressedSet(eventId, [i.email])).size) throw new ApiError(409, ['Modtageren har afmeldt sig.'], { code: 'not_mailable' });
  if (!(await reserveQuota(1))) throw new ApiError(429, ['Dagens mailkvote er brugt op. Prøv igen i morgen.'], { code: 'quota' });
  const gen = (i.inviteGen ?? 0) + 1;
  const it = inviteTokenFor(i.id, gen);
  await prisma.invitation.update({ where: { id: i.id }, data: { inviteGen: gen, inviteTokenHash: sha256Hex(it), revokedAt: null, delivery: 'queued' } });
  if (!ev.inviteTracking) await prisma.event.update({ where: { id: eventId }, data: { inviteTracking: true } });
  const plan = planInvitations(p, [{ email: i.email, name: i.name ?? undefined, linkToken: linkTokenFor(i.id), inviteToken: it }], { appUrl: appUrl() });
  const m = plan.messages.map((x) => ({ ...x, idempotencyKey: `${x.idempotencyKey}:g${gen}` }));
  return deliver(eventId, m, new Map([[i.email, i.id]]));
}

/** Revoke: the personal link stops working at once; an existing answer is kept (but can't be edited via the link). */
export async function revokeInvite(eventId: number, email: unknown, reissue: unknown) {
  const i = await invitationFor(eventId, email);
  if (i.inviteGen === null) throw new ApiError(409, ['Modtageren har intet personligt link.'], { code: 'no_personal_link' });
  await prisma.invitation.update({ where: { id: i.id }, data: { revokedAt: new Date(), inviteTokenHash: null, inviteGen: i.inviteGen + 1 } });
  if (reissue === true) return { revoked: true, ...(await resendInvite(eventId, email)) };
  return { revoked: true };
}

/** Organizer links a public ("ikke inviteret") answer to an invitee without an answer; undoable via unlink. */
export async function linkAnswer(eventId: number, email: unknown, participantId: unknown) {
  const i = await invitationFor(eventId, email);
  if (typeof participantId !== 'number' || !Number.isInteger(participantId)) throw new ApiError(400, ['Vælg et svar.'], { code: 'participant_required' });
  const part = await prisma.participant.findUnique({ where: { id: participantId }, select: { eventId: true } });
  if (!part || part.eventId !== eventId) throw new ApiError(404, ['Svaret findes ikke.']);
  if (i.participantId !== null) throw new ApiError(409, ['Modtageren har allerede et svar.'], { code: 'already_answered' });
  try {
    await prisma.invitation.update({ where: { id: i.id }, data: { participantId, linkedManually: true } });
  } catch (e) { if ((e as { code?: string }).code === 'P2002') throw new ApiError(409, ['Svaret er allerede knyttet til en anden modtager.'], { code: 'already_linked' }); throw e; }
  return { linked: true };
}
export async function unlinkAnswer(eventId: number, email: unknown) {
  const i = await invitationFor(eventId, email);
  if (!i.linkedManually) throw new ApiError(409, ['Kun manuelle koblinger kan fortrydes.'], { code: 'not_manual' });
  await prisma.invitation.update({ where: { id: i.id }, data: { participantId: null, linkedManually: false } });
  return { unlinked: true };
}

/** Vote page: who is this personal link for? null if unknown/revoked/other poll. */
export async function inviteByToken(eventId: number, token: string | null) {
  if (!token || !TOKEN_RE.test(token)) return null;
  const i = await prisma.invitation.findUnique({ where: { inviteTokenHash: sha256Hex(token) }, select: { id: true, eventId: true, email: true, name: true, revokedAt: true, participantId: true } });
  if (!i || i.eventId !== eventId || i.revokedAt) return null;
  return i;
}
/** After a vote via a personal link: record the answer (first answer wins; never steals another link's answer). */
export async function claimInvite(eventId: number, token: string | null, participantId: number) {
  const i = await inviteByToken(eventId, token);
  if (!i || i.participantId !== null) return false;
  try {
    const r = await prisma.invitation.updateMany({ where: { id: i.id, participantId: null, revokedAt: null }, data: { participantId, linkedManually: false } });
    return r.count === 1;
  } catch { return false; }
}
