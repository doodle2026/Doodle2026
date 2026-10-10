/**
 * the design spec (doodle-ui) e-mail templates (invitation / reminder) → { subject, html, text }.
 * Templates are synced verbatim into ./templates.ts (scripts/sync-email-templates.mjs); Mustache escapes all
 * user values in HTML. Times are formatted server-side in Danish, 24 h, in the poll's time zone.
 */
import Mustache from 'mustache';
import { TEMPLATES } from './templates';
import { formatDateLong } from '../dates';

export interface PollEmailData {
  assetBaseUrl: string; appUrl: string; eventTitle: string; organizerName: string; recipientName?: string;
  description?: string; pollUrl: string; optionCount: number; timeZoneLabel: string;
  dates: { dateLabel: string; slots: { timeLabel: string }[] }[];
  deadline?: string; respondedCount?: number; footerText?: string;
  /** Organizer's optional message: plain text, ≤ 1000 graphemes, escaped by the template (pre-line). */
  personalMessage?: string;
  unsubscribePollUrl: string; unsubscribeAllUrl: string; reportAbuseUrl: string;
  /** Date-only poll: date list without times or time-zone text (see DATE_TEMPLATES). */
  dateOnly?: boolean;
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

/** Options → chronologically sorted date groups with slot labels. */
export function groupDates(options: { startAt: Date; endAt: Date | null }[], tz = DEFAULT_TZ): PollEmailData['dates'] {
  const f = formatters(tz);
  const out: (PollEmailData['dates'][number] & { k: string })[] = [];
  for (const o of [...options].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())) {
    const k = f.dayKey(o.startAt);
    let g = out[out.length - 1];
    if (!g || g.k !== k) out.push(g = { k, dateLabel: f.dateLabel(o.startAt), slots: [] });
    g.slots.push({ timeLabel: f.timeLabel(o.startAt, o.endAt) });
  }
  return out.map(({ dateLabel, slots }) => ({ dateLabel, slots }));
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

/**
 * Date-only variant of the synced templates. Until the design templates get a date-only mode upstream, the
 * time wording and the time-zone line are rewritten here (only in this derived copy; timed legacy polls use the originals).
 */
const dateOnlyRules: [RegExp, string][] = [
  [/<tr><td[^>]*>Tider vist i \{\{timeZoneLabel\}\}[^<]*<\/td><\/tr>\n?/g, ''],
  [/ – vist i \{\{timeZoneLabel\}\}/g, ''],
  [/FORESLÅEDE TIDSPUNKTER/g, 'FORESLÅEDE DATOER'], [/Foreslåede tidspunkter/g, 'Foreslåede datoer'],
  [/Stem på tidspunkter/g, 'Vælg datoer'], [/finde et tidspunkt/g, 'finde en dato'], [/tidspunkter/g, 'datoer'], [/tidspunkt/g, 'dato'],
];
const dateOnly = (t: string) => dateOnlyRules.reduce((s, [a, b]) => s.replace(a, b), t);
export const DATE_TEMPLATES = {
  invitation: { html: dateOnly(TEMPLATES.invitation.html), text: dateOnly(TEMPLATES.invitation.text) },
  reminder: { html: dateOnly(TEMPLATES.reminder.html), text: dateOnly(TEMPLATES.reminder.text) },
};

/** Date options → one entry per date, "Tirsdag 3. november 2026", no slots (same output in every process TZ). */
export function groupPlainDates(dates: string[]): PollEmailData['dates'] {
  return [...new Set(dates)].sort().map((d) => ({ dateLabel: cap(formatDateLong(d)), slots: [] }));
}

function render(kind: 'invitation' | 'reminder', d: PollEmailData, subject: string): Rendered {
  const T = d.dateOnly ? DATE_TEMPLATES : TEMPLATES;
  assertPublicOnly(d);
  const data = { ...d, description: d.description?.trim() || undefined, personalMessage: d.personalMessage?.trim() || undefined, respondedCount: d.respondedCount || undefined };
  const r = { subject: oneLine(subject), html: Mustache.render(T[kind].html, data, undefined, { escape }), text: Mustache.render(T[kind].text, data, undefined, { escape: String }) }; // plain text: no HTML escaping
  assertPublicOnly(d, r);
  return r;
}
export const renderInvitation = (d: PollEmailData) => render('invitation', d, `${d.organizerName} inviterer dig: ${clip(d.eventTitle)}`);
export const renderReminder = (d: PollEmailData) =>
  render('reminder', d, `Påmindelse: ${clip(d.eventTitle)}${d.deadline ? ` – lukker ${d.deadline}` : ''}`);
