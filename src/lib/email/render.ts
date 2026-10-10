/**
 * the design spec (doodle-ui) e-mail templates (invitation / reminder) → { subject, html, text }.
 * Templates are synced verbatim into ./templates.ts (scripts/sync-email-templates.mjs); Mustache escapes all
 * user values in HTML. Times are formatted server-side in Danish, 24 h, in the poll's time zone.
 */
import Mustache from 'mustache';
import { TEMPLATES } from './templates';
import { formatDateShort } from '../dates';

export interface PollEmailData {
  assetBaseUrl: string; appUrl: string; eventTitle: string; organizerName: string; recipientName?: string;
  description?: string; pollUrl: string; optionCount: number;
  /** One per option, chronological: "fre. 16. okt. 2026"; legacy timed options add " kl. 09:00–10:00" (Europe/Copenhagen). */
  dates: { dateLabel: string }[];
  /** Reminder footer: tracking on → "kun til inviterede, der ikke har svaret". */
  trackingEnabled?: boolean;
  deadline?: string; respondedCount?: number; footerText?: string;
  /** Organizer's optional message: plain text, ≤ 1000 graphemes, escaped by the template (pre-line). */
  personalMessage?: string;
  unsubscribePollUrl: string; unsubscribeAllUrl: string; reportAbuseUrl: string;
}
export interface Rendered { subject: string; html: string; text: string }

export const DEFAULT_TZ = 'Europe/Copenhagen';
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const seg = new Intl.Segmenter('da', { granularity: 'grapheme' });
export const clip = (s: string, n = 60) => { const g = [...seg.segment(s)].map((x) => x.segment); return g.length > n ? g.slice(0, n - 1).join('') + '…' : s; };
/** Subject is plain text: single line, no control chars. */
const oneLine = (s: string) => s.replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();

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

/** Options → chronological labels. Date options are time-zone free; legacy timed ones get "kl. HH:MM–HH:MM" in `tz`. */
export function dateLabels(options: ({ date: string } | { startAt: Date; endAt: Date | null })[], tz = DEFAULT_TZ): PollEmailData['dates'] {
  const f = formatters(tz);
  const short = new Intl.DateTimeFormat('da-DK', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: tz });
  const key = (o: (typeof options)[number]) => ('date' in o ? `${o.date}T00:00:00.000Z` : o.startAt.toISOString());
  return [...options].sort((a, b) => key(a).localeCompare(key(b))).map((o) =>
    'date' in o ? { dateLabel: formatDateShort(o.date) } : { dateLabel: `${short.format(o.startAt)} kl. ${f.timeLabel(o.startAt, o.endAt)}` });
}

/** Public poll link, optionally with a personal invite fragment (#inv=<43-char token>, step 5) – never admin/edit. */
const POLL_URL_RE = /^https?:\/\/[^/\s?#]+\/p\/[A-Za-z0-9_-]{1,64}(?:#inv=[A-Za-z0-9_-]{43})?$/;
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
  const T = TEMPLATES;
  assertPublicOnly(d);
  const data = { ...d, description: d.description?.trim() || undefined, personalMessage: d.personalMessage?.trim() || undefined, respondedCount: d.respondedCount || undefined };
  const r = { subject: oneLine(subject), html: Mustache.render(T[kind].html, data, undefined, { escape }), text: Mustache.render(T[kind].text, data, undefined, { escape: String }) }; // plain text: no HTML escaping
  assertPublicOnly(d, r);
  return r;
}
export const renderInvitation = (d: PollEmailData) => render('invitation', d, `${d.organizerName} inviterer dig: ${clip(d.eventTitle)}`);
export const renderReminder = (d: PollEmailData) =>
  render('reminder', d, `Påmindelse: ${clip(d.eventTitle)}${d.deadline ? ` – lukker ${d.deadline}` : ''}`);
