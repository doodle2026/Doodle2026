/**
 * Who gets which mail (pure; persistence comes with the invite feature). Rules enforced here:
 * - only the public /p/<id> link (pollUrl built from APP_URL + slug; render asserts no admin/edit links)
 * - one message per recipient (never a shared `to`), replyTo = organizer, idempotency key per recipient
 * - reminders: only to invitees who haven't answered, at most ONE per recipient, none after the poll is closed
 * - unsubscribed invitees get nothing; List-Unsubscribe (+ One-Click) header when an unsubscribe URL exists
 */
import { DEFAULT_TZ, formatters, groupDates, renderInvitation, renderReminder, type PollEmailData } from './render';
import { isEmail, type EmailMessage } from './send';

export interface PollForEmail {
  slug: string; title: string; description?: string; isClosed: boolean;
  organizerName: string; organizerEmail?: string;
  options: { startAt: Date; endAt: Date | null }[];
  deadline?: Date | null; respondedCount?: number; timeZone?: string;
}
export interface Invitee {
  email: string; name?: string;
  respondedAt?: Date | null; remindedAt?: Date | null; unsubscribedAt?: Date | null;
  unsubscribeUrl?: string;
}
export interface EmailCtx { appUrl: string; footerText?: string }
export type SkipReason = 'invalid_email' | 'duplicate' | 'unsubscribed' | 'closed' | 'responded' | 'already_reminded';
export interface Plan { messages: (EmailMessage & { to: string })[]; skipped: { email: string; reason: SkipReason }[] }

const norm = (e: string) => e.trim().toLowerCase();
const base = (u: string) => u.replace(/\/+$/, '');

export function pollEmailData(p: PollForEmail, inv: Invitee, ctx: EmailCtx): PollEmailData {
  const tz = p.timeZone ?? DEFAULT_TZ;
  const app = base(ctx.appUrl);
  return {
    assetBaseUrl: `${app}/email-assets`, appUrl: app,
    eventTitle: p.title, organizerName: p.organizerName, recipientName: inv.name?.trim() || undefined,
    description: p.description, pollUrl: `${app}/p/${encodeURIComponent(p.slug)}`,
    optionCount: p.options.length, timeZoneLabel: tz === DEFAULT_TZ ? 'dansk tid (Europe/Copenhagen)' : tz,
    dates: groupDates(p.options, tz), deadline: p.deadline ? formatters(tz).deadline(p.deadline) : undefined,
    respondedCount: p.respondedCount, footerText: ctx.footerText ?? 'Mødetid · Planlæg møder uden login',
    unsubscribeUrl: inv.unsubscribeUrl && /^https:\/\//.test(inv.unsubscribeUrl) ? inv.unsubscribeUrl : undefined,
  };
}

function message(kind: 'invite' | 'reminder', p: PollForEmail, inv: Invitee, ctx: EmailCtx): EmailMessage & { to: string } {
  const d = pollEmailData(p, inv, ctx);
  const r = kind === 'invite' ? renderInvitation(d) : renderReminder(d);
  const email = norm(inv.email);
  return {
    to: inv.email.trim(), subject: r.subject, html: r.html, text: r.text,
    replyTo: p.organizerEmail && isEmail(p.organizerEmail) ? p.organizerEmail : undefined,
    idempotencyKey: `${kind}:${p.slug}:${email}`,
    headers: d.unsubscribeUrl ? { 'List-Unsubscribe': `<${d.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined,
    tags: [{ name: 'type', value: kind === 'invite' ? 'invitation' : 'reminder' }, { name: 'poll', value: p.slug }],
  };
}

function plan(kind: 'invite' | 'reminder', p: PollForEmail, invitees: Invitee[], ctx: EmailCtx): Plan {
  const out: Plan = { messages: [], skipped: [] };
  const seen = new Set<string>();
  for (const inv of invitees) {
    const e = norm(inv.email);
    const skip = (reason: SkipReason) => out.skipped.push({ email: inv.email, reason });
    if (!isEmail(e)) { skip('invalid_email'); continue; }
    if (seen.has(e)) { skip('duplicate'); continue; }
    seen.add(e);
    if (inv.unsubscribedAt) { skip('unsubscribed'); continue; }
    if (p.isClosed) { skip('closed'); continue; }
    if (kind === 'reminder') {
      if (inv.respondedAt) { skip('responded'); continue; }
      if (inv.remindedAt) { skip('already_reminded'); continue; }
    }
    out.messages.push(message(kind, p, inv, ctx));
  }
  return out;
}

export const planInvitations = (p: PollForEmail, invitees: Invitee[], ctx: EmailCtx) => plan('invite', p, invitees, ctx);
/** Caller must persist `remindedAt` for every planned recipient (atomically, before/with sending). */
export const planReminders = (p: PollForEmail, invitees: Invitee[], ctx: EmailCtx) => plan('reminder', p, invitees, ctx);
