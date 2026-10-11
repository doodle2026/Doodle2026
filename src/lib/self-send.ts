/**
 * "Send til mig selv" (spec 11 Oct): the organizer mails the admin link to one address they type in.
 * - admin token required (route); the server builds the links – the client sends only { email, locale? }
 * - one recipient, fixed template, no free text, no replyTo, sender = grabAday
 * - limits: 3 per poll in total, ≥ 60 s between two sends for the same poll, 10 per client IP per UTC day,
 *   plus the existing per-IP mail bucket (route) and the global daily/monthly Resend quota
 * - no open/click tracking: plain links, no pixel; tags only type/poll (Resend tracking must stay off for the domain)
 * - suppression list checked; a suppressed address gets the same neutral 'blocked' answer as any other refused address
 * - address never stored in clear text: SelfSend keeps hash(email), hash(IP), hash(footer token), poll id, time
 */
import { createHash } from 'node:crypto';
import { prisma } from './db';
import { ApiError } from './events';
import { clientIp } from './client-ip';
import { emailHash, reserveQuota, releaseQuota } from './invitations';
import { normEmail } from './recipients';
import { isBareEmail, maskEmail, mailer } from './email/send';
import { APP_NAME } from './email/policy';
import { dateLabels, mailLocale, renderOrganizerLinks } from './email/render';
import { bumpStat } from './owner/counters';
import { newToken, sha256Hex } from './tokens';

export const SELF_POLL_MAX = 3;
export const SELF_GAP_MS = 60_000;
export const SELF_IP_DAY_MAX = 10;

const ipHash = (ip: string) => createHash('sha256').update(`${process.env.EMAIL_HASH_PEPPER ?? ''}grabaday-self-ip-v1:${ip}`).digest('hex');
const base = (u: string) => u.replace(/\/+$/, '');
const secsToUtcMidnight = () => { const n = Date.now(); return (Date.UTC(new Date(n).getUTCFullYear(), new Date(n).getUTCMonth(), new Date(n).getUTCDate() + 1) - n) / 1000; };
const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

const err = (status: number, error: string, extra: Record<string, unknown> = {}) => new ApiError(status, [error], { ok: false, error, code: error, ...extra });
/** §48.2 / PM 11 Oct: every limit (incl. quota) → 429 + Retry-After + reason wait|poll_max|ip|hour|quota. */
export const limit = (reason: 'wait' | 'poll_max' | 'ip' | 'hour' | 'quota', retryAfter: number) =>
  new ApiError(429, [reason], { ok: false, error: reason, reason, code: reason === 'quota' ? 'quota' : `self_${reason}`, retry_after: Math.max(1, Math.ceil(retryAfter)) });

export async function sendToSelf(eventId: number, adminToken: string, req: Request, body: unknown, explicitLocale: string | null) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const extra = Object.keys(b).filter((k) => k !== 'email' && k !== 'locale');
  if (extra.length) throw err(400, 'invalid', { fields: extra }); // never accept links/text/cc from the client
  const raw = typeof b.email === 'string' ? b.email : '';
  if (raw.includes(',') || raw.includes(';')) throw err(400, 'invalid'); // one recipient only
  // Bare address only: 'Name <addr>', quotes, angle brackets, whitespace/CRLF are rejected (never hashed or used as To).
  const email = normEmail(raw.replace(/^mailto:/i, ''));
  if (!email || !isBareEmail(email)) throw err(400, 'invalid');

  const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { slug: true, title: true, locale: true, mailBlockedAt: true, timeOptions: { select: { date: true } } } });
  if (!ev) throw new ApiError(404, ['Afstemningen findes ikke.']);
  const L = mailLocale(typeof b.locale === 'string' ? b.locale : null, explicitLocale, ev.locale);
  const now = new Date(), eh = emailHash(email), ih = ipHash(clientIp(req));
  const token = newToken();

  // Limits + attempt row atomically per poll (concurrent clicks can't exceed 3 or the 60 s gap).
  const row = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(724002, ${eventId}::int)`;
    const rows = await tx.selfSend.findMany({ where: { eventId }, select: { createdAt: true }, orderBy: { createdAt: 'desc' } });
    if (rows.length >= SELF_POLL_MAX) throw limit('poll_max', 86400);
    const since = rows[0] ? now.getTime() - rows[0].createdAt.getTime() : Infinity;
    if (since < SELF_GAP_MS) throw limit('wait', (SELF_GAP_MS - since) / 1000);
    const ipToday = await tx.selfSend.count({ where: { ipHash: ih, createdAt: { gte: startOfUtcDay(now) } } });
    if (ipToday >= SELF_IP_DAY_MAX) throw limit('ip', (startOfUtcDay(now).getTime() + 86400_000 - now.getTime()) / 1000);
    // The attempt counts even if the address turns out to be refused → limits can't be used to probe the suppression list.
    return tx.selfSend.create({ data: { eventId, emailHash: eh, ipHash: ih, linkTokenHash: sha256Hex(token) }, select: { id: true } });
  });

  const suppressed = ev.mailBlockedAt || await prisma.emailSuppression.count({ where: { emailHash: eh, scope: { in: ['all', `poll:${eventId}`] } } });
  if (suppressed) throw err(409, 'blocked');
  if (!(await reserveQuota(1, now))) {
    await prisma.selfSend.delete({ where: { id: row.id } }).catch(() => undefined); // not the user's fault: don't burn one of the 3
    throw limit('quota', secsToUtcMidnight());
  }

  const app = base(process.env.APP_URL || 'http://localhost:3000'), lp = `${app}/${L}`;
  const slug = encodeURIComponent(ev.slug);
  const opts = ev.timeOptions.map((o) => ({ date: o.date.toISOString().slice(0, 10) }));
  const m = renderOrganizerLinks({ locale: L, eventTitle: ev.title, appUrl: app, assetBaseUrl: `${app}/email-assets`, adminUrl: `${lp}/p/${slug}/admin#${adminToken}`,
    pollUrl: `${lp}/p/${slug}`, unsubscribeAllUrl: `${lp}/u/all/${token}`, dates: dateLabels(opts, L), optionCount: opts.length });
  const r = await mailer().send({
    to: email, subject: m.subject, html: m.html, text: m.text, fromName: APP_NAME, idempotencyKey: `self:${eventId}:${row.id}`,
    headers: { 'List-Unsubscribe': `<${app}/api/u/all/${token}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    tags: [{ name: 'type', value: 'self' }, { name: 'poll', value: ev.slug }],
  });
  if (!r.ok) {
    await releaseQuota(1, now);
    await prisma.selfSend.delete({ where: { id: row.id } }).catch(() => undefined);
    throw err(503, 'server'); // Resend failed – the only 503
  }
  await bumpStat('self_sent');
  const used = await prisma.selfSend.count({ where: { eventId } });
  return { ok: true, sent_to: maskEmail(email), remaining: Math.max(0, SELF_POLL_MAX - used), next_in: Math.ceil(SELF_GAP_MS / 1000) };
}

/** Footer token of a self-send mail → hash of the address (for the "unsubscribe from all" landing page). */
export async function selfByToken(token: string) {
  return prisma.selfSend.findUnique({ where: { linkTokenHash: sha256Hex(token) }, select: { emailHash: true, event: { select: { title: true, slug: true } } } });
}

export async function selfStatus(eventId: number) {
  const rows = await prisma.selfSend.findMany({ where: { eventId }, select: { createdAt: true }, orderBy: { createdAt: 'desc' } });
  const wait = rows[0] ? Math.max(0, Math.ceil((SELF_GAP_MS - (Date.now() - rows[0].createdAt.getTime())) / 1000)) : 0;
  return { remaining: Math.max(0, SELF_POLL_MAX - rows.length), next_in: wait };
}
