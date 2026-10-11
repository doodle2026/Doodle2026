/**
 * Who gets which mail (pure; persistence comes with the invite feature). Rules enforced here:
 * - only the public /p/<id> link (pollUrl built from APP_URL + slug; render asserts no admin/edit links)
 * - one message per recipient (never a shared `to`), idempotency key per recipient; NO per-message replyTo
 *   (organizer e-mail is unverified – only the optional global EMAIL_REPLY_TO applies)
 * - reminders are manual, per poll: at most one per 24 h and 3 in total, none to closed polls; only to invitees
 *   who are not unsubscribed (answered or not – per the functional spec)
 * - unsubscribed invitees get nothing; List-Unsubscribe (+ One-Click) header when an unsubscribe URL exists
 */
import { DEFAULT_TZ, deadlineLabel, dateLabels, fromNameFor, mailLocale, renderInvitation, renderReminder, type MailLocale, type PollEmailData } from './render';
import en from '../../../messages/en.json';
import da from '../../../messages/da.json';
import fr from '../../../messages/fr.json';
import de from '../../../messages/de.json';

const ORGANIZER: Record<MailLocale, string> = { en: 'The organizer', da: 'Arrangøren', fr: 'L’organisateur', de: 'Der Organisator' };
const FOOTER: Record<MailLocale, string> = { en: en.email.footerText, da: da.email.footerText, fr: fr.email.footerText, de: de.email.footerText };
import { isEmail, sanitizeDisplayName, type EmailMessage } from './send';

export const APP_NAME = 'GrabAday';

export interface PollForEmail {
  slug: string; title: string; description?: string; isClosed: boolean;
  organizerName: string;
  /** Optional organizer name from the invite request (raw; sanitized for From). */
  organizerFromName?: string;
  /** Reminder history for the poll (persisted by the caller). */
  remindersSent?: number; lastReminderAt?: Date | null;
  /** Step 5 tracking on → reminder footer says they go only to those who haven't answered. */
  trackingEnabled?: boolean;
  options: { date: string }[];
  deadline?: Date | null; respondedCount?: number; timeZone?: string;
  /** Poll language (fallback for invitees without their own). */
  locale?: string;
}
export interface Invitee {
  email: string; name?: string;
  respondedAt?: Date | null; unsubscribedAt?: Date | null;
  /** Raw per-recipient footer token (only its SHA-256 is stored). */
  linkToken: string;
  /** Step 5: personal invite token → pollUrl gets #inv=<token>. */
  inviteToken?: string;
  /** Hard bounce / complaint: cannot receive mail. */
  bounced?: boolean;
  /** Recipient's language (Invitation.locale). */
  locale?: string;
}
export interface EmailCtx { appUrl: string; footerText?: string; personalMessage?: string }
export type SkipReason = 'invalid_email' | 'duplicate' | 'unsubscribed' | 'closed' | 'bounced';
export type ReminderBlock = 'closed' | 'too_soon' | 'limit_reached';
export const REMINDER_MAX = 3;
export const REMINDER_GAP_MS = 24 * 3600_000;
export interface Plan { messages: (EmailMessage & { to: string })[]; skipped: { email: string; reason: SkipReason }[] }

const norm = (e: string) => e.trim().toLowerCase();
const base = (u: string) => u.replace(/\/+$/, '');

export function pollEmailData(p: PollForEmail, inv: Invitee, ctx: EmailCtx): PollEmailData {
  const tz = p.timeZone ?? DEFAULT_TZ;
  const app = base(ctx.appUrl);
  const L = mailLocale(inv.locale, p.locale); // recipient → poll → en; links always APP_URL/<locale>/...
  const lp = `${app}/${L}`;
  return {
    assetBaseUrl: `${app}/email-assets`, appUrl: app,
    eventTitle: p.title, organizerName: p.organizerName || ORGANIZER[L], recipientName: inv.name?.trim() || undefined,
    description: p.description, pollUrl: `${lp}/p/${encodeURIComponent(p.slug)}${inv.inviteToken ? `#inv=${inv.inviteToken}` : ''}`,
    optionCount: p.options.length, dates: dateLabels(p.options, L), trackingEnabled: !!p.trackingEnabled, deadline: p.deadline ? deadlineLabel(p.deadline, L, tz) : undefined,
    respondedCount: p.respondedCount, footerText: ctx.footerText ?? FOOTER[L],
    personalMessage: ctx.personalMessage,
    unsubscribePollUrl: `${lp}/u/p/${inv.linkToken}`,
    unsubscribeAllUrl: `${lp}/u/all/${inv.linkToken}`,
    reportAbuseUrl: `${lp}/abuse/${inv.linkToken}`,
    locale: L,
  };
}

function message(kind: 'invite' | 'reminder', p: PollForEmail, inv: Invitee, ctx: EmailCtx): EmailMessage & { to: string } {
  const d = pollEmailData(p, inv, ctx);
  const r = kind === 'invite' ? renderInvitation(d) : renderReminder(d);
  const email = norm(inv.email);
  const who = p.organizerFromName ? sanitizeDisplayName(p.organizerFromName) : '';
  return {
    fromName: who ? fromNameFor(who, d.locale) : APP_NAME,
    to: inv.email.trim(), subject: r.subject, html: r.html, text: r.text,
    idempotencyKey: `${kind}:${p.slug}:${email}`,
    // RFC 8058 one-click: POST to this URL unsubscribes from this poll.
    headers: { 'List-Unsubscribe': `<${base(ctx.appUrl)}/api/u/p/${inv.linkToken}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
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
    if (inv.bounced) { skip('bounced'); continue; }
    if (p.isClosed) { skip('closed'); continue; }
    out.messages.push(message(kind, p, inv, ctx));
  }
  return out;
}

export const planInvitations = (p: PollForEmail, invitees: Invitee[], ctx: EmailCtx) => plan('invite', p, invitees, ctx);
/** Poll-level reminder gate: none when closed, max one per 24 h, max REMINDER_MAX in total. */
export function reminderBlock(p: PollForEmail, now = new Date()): ReminderBlock | null {
  if (p.isClosed) return 'closed';
  if ((p.remindersSent ?? 0) >= REMINDER_MAX) return 'limit_reached';
  if (p.lastReminderAt && now.getTime() - p.lastReminderAt.getTime() < REMINDER_GAP_MS) return 'too_soon';
  return null;
}
/**
 * Manual reminder round. Returns { blocked } instead of messages when the poll-level gate says no.
 * Caller must atomically bump remindersSent/lastReminderAt (row lock) before sending.
 */
export function planReminders(p: PollForEmail, invitees: Invitee[], ctx: EmailCtx, now = new Date()): Plan & { blocked: ReminderBlock | null } {
  const blocked = reminderBlock(p, now);
  if (blocked) return { messages: [], skipped: [], blocked };
  return { ...plan('reminder', p, invitees, ctx), blocked: null };
}
