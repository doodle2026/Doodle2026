/**
 * the design spec (doodle-ui) e-mail templates (invitation / reminder) → { subject, html, text }.
 * Templates are synced verbatim into ./templates.ts (scripts/sync-email-templates.mjs); Mustache escapes all
 * user values in HTML. Dates are plain days; only a deadline (instant) uses a time zone.
 */
import Mustache from 'mustache';
import { TEMPLATES } from './templates';
import { formatDateShort, type DateLocale } from '../dates';

export type MailLocale = DateLocale;
export const MAIL_LOCALES: MailLocale[] = ['en', 'da', 'fr', 'de'];
/** Recipient locale → poll locale → en. */
export const mailLocale = (...c: (string | null | undefined)[]): MailLocale => (c.find((x) => MAIL_LOCALES.includes(x as MailLocale)) as MailLocale) ?? 'en';
const TAG: Record<MailLocale, string> = { en: 'en-GB', da: 'da-DK', fr: 'fr-FR', de: 'de-DE' };

export interface PollEmailData {
  assetBaseUrl: string; appUrl: string; eventTitle: string; organizerName: string; recipientName?: string;
  description?: string; pollUrl: string; optionCount: number;
  /** One per option, chronological: "fre. 16. okt. 2026". */
  dates: { dateLabel: string }[];
  /** Reminder footer: tracking on → "kun til inviterede, der ikke har svaret". */
  trackingEnabled?: boolean;
  deadline?: string; respondedCount?: number; footerText?: string;
  /** Organizer's optional message: plain text, ≤ 1000 graphemes, escaped by the template (pre-line). */
  personalMessage?: string;
  unsubscribePollUrl: string; unsubscribeAllUrl: string; reportAbuseUrl: string;
  /** Mail language (templates, subject, date labels). Default en. */
  locale?: MailLocale;
}
export interface Rendered { subject: string; html: string; text: string }

export const DEFAULT_TZ = 'Europe/Copenhagen';
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const seg = new Intl.Segmenter('da', { granularity: 'grapheme' });
export const clip = (s: string, n = 60) => { const g = [...seg.segment(s)].map((x) => x.segment); return g.length > n ? g.slice(0, n - 1).join('') + '…' : s; };
/** Subject is plain text: single line, no control chars. */
const oneLine = (s: string) => s.replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Deadline is an instant → shown in Europe/Copenhagen, in the mail's language. */
export function deadlineLabel(d: Date, locale: MailLocale = 'en', tz = DEFAULT_TZ) {
  return new Intl.DateTimeFormat(TAG[locale], { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(d);
}

export function formatters(tz = DEFAULT_TZ) {
  const day = new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz });
  const hmF = new Intl.DateTimeFormat('da-DK', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz });
  const key = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz });
  const dl = new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });
  const hm = (d: Date) => hmF.format(d).replace('.', ':');
  return {
    dateLabel: (d: Date) => cap(day.format(d)).replace(/ den /, ' '), // "Onsdag 14. oktober 2026"
    timeLabel: (s: Date, e: Date | null) => (e ? `${hm(s)}–${hm(e)}${key.format(s) === key.format(e) ? '' : ' (+1 dag)'}` : hm(s)),
    dayKey: (d: Date) => key.format(d),
    deadline: (d: Date) => `${dl.format(d).replace(/ den /, ' ')} kl. ${hm(d)}`, // "fredag 16. oktober kl. 12:00"
  };
}

/** Options → chronological labels "fre. 16. okt. 2026" (time-zone free). */
export function dateLabels(options: { date: string }[], locale: MailLocale = 'en'): PollEmailData['dates'] {
  return [...options].sort((a, b) => a.date.localeCompare(b.date)).map((o) => ({ dateLabel: formatDateShort(o.date, locale) }));
}

/** Public poll link, optionally with a personal invite fragment (#inv=<43-char token>, step 5) – never admin/edit. */
const POLL_URL_RE = /^https?:\/\/[^/\s?#]+\/(?:(?:en|da|fr|de)\/)?p\/[A-Za-z0-9_-]{1,64}(?:#inv=[A-Za-z0-9_-]{43})?$/;
const SECRET_LINK_RE = /\/p\/[A-Za-z0-9_-]+\/admin|[#?&]edit=|\/admin#/i;
/** Hard rule: mails carry only the public /p/<id> link – never admin or edit tokens. Throws otherwise. */
export function assertPublicOnly(d: PollEmailData, r?: Rendered) {
  if (!POLL_URL_RE.test(d.pollUrl)) throw new Error('email: pollUrl must be the public /p/<id> link');
  const all = r ? `${r.subject}\n${decode(r.html)}\n${r.text}` : JSON.stringify(d);
  if (SECRET_LINK_RE.test(all)) throw new Error('email: admin/edit link in mail content');
}

/** HTML escape without touching "/" (Mustache's default turns URLs into &#x2F;, which also hides links from our checks). */
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (v: unknown) => String(v).replace(/[&<>"']/g, (c) => ESC[c]);
const decode = (s: string) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&');

function render(kind: 'invitation' | 'reminder', d: PollEmailData, subject: string): Rendered {
  const T = TEMPLATES[mailLocale(d.locale)];
  assertPublicOnly(d);
  const data = { ...d, description: d.description?.trim() || undefined, personalMessage: d.personalMessage?.trim() || undefined, respondedCount: d.respondedCount || undefined };
  const r = { subject: oneLine(subject), html: Mustache.render(T[kind].html, data, undefined, { escape }), text: Mustache.render(T[kind].text, data, undefined, { escape: String }) }; // plain text: no HTML escaping
  assertPublicOnly(d, r);
  return r;
}
const plain = (tpl: string, d: PollEmailData) => Mustache.render(tpl, { ...d, eventTitle: clip(d.eventTitle) }, undefined, { escape: String });
const S = (d: PollEmailData) => TEMPLATES[mailLocale(d.locale)].strings;
export const renderInvitation = (d: PollEmailData) => render('invitation', d, plain(S(d).invitation.subject, d));
export const renderReminder = (d: PollEmailData) =>
  render('reminder', d, plain(d.deadline ? S(d).reminder.subjectWithDeadline : S(d).reminder.subject, d));
/** "<name> via grabAday" in the mail language (name already sanitized). */
export const fromNameFor = (organizerName: string, locale?: string) => plain(TEMPLATES[mailLocale(locale)].strings.fromName, { organizerName } as PollEmailData);
/** .ics SUMMARY/DESCRIPTION in the given language. */
export function icsTexts(eventTitle: string, pollUrl: string, locale?: string) {
  const s = TEMPLATES[mailLocale(locale)].strings.ics;
  const r = (t: string) => Mustache.render(t, { eventTitle, pollUrl }, undefined, { escape: String });
  return { summary: r(s.summary), description: r(s.description) };
}

/** "Send til mig selv" (§48.5): the ONLY mail allowed to carry the admin link – to the address the organizer typed. */
export interface OrganizerLinksData {
  locale: MailLocale; eventTitle: string; adminUrl: string; pollUrl: string; appUrl: string; assetBaseUrl: string;
  unsubscribeAllUrl: string; dates: { dateLabel: string }[]; optionCount: number;
}
export function renderOrganizerLinks(d: OrganizerLinksData): Rendered {
  const T = TEMPLATES[mailLocale(d.locale)];
  const data = { ...d, eventTitle: clip(d.eventTitle, 100) };
  return {
    subject: oneLine(Mustache.render(T.strings.organizerLinks.subject, data, undefined, { escape: String })),
    html: Mustache.render(T.organizerLinks.html, data, undefined, { escape }),
    text: Mustache.render(T.organizerLinks.text, data, undefined, { escape: String }),
  };
}
