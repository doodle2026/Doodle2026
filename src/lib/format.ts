import { nextDayMarker } from './vote-client';
import { addDays, basicDate, formatDateShort } from './dates';
// Browser-side formatting helpers (Danish, 24 h, browser time zone).
const dayShort = new Intl.DateTimeFormat('da-DK', { weekday: 'short', day: 'numeric', month: 'short' });
const time = new Intl.DateTimeFormat('da-DK', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const keyFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Ons. 14. okt. · 09:00–10:00" (design §20/§21). */
export function whenLabel(startIso: string, endIso: string | null): string {
  const s = new Date(startIso);
  let out = `${cap(dayShort.format(s))} · ${time.format(s)}`;
  if (endIso) {
    const e = new Date(endIso);
    out += '–' + time.format(e) + nextDayMarker(keyFmt.format(s), keyFmt.format(e)); // V8: "23.30–00.30 (+1 dag)"
  }
  return out;
}

/** Local YYYY-MM-DD / HH:MM from an ISO instant (browser zone). */
export const localDate = (iso: string) => keyFmt.format(new Date(iso));
export const localTime = (iso: string) => time.format(new Date(iso));

/** Score for "★ Bedst": yes = 2, maybe = 1 (design §15.3). */
export const score = (v: { yes: number; maybe: number }) => v.yes * 2 + v.maybe;

/** Ids of the best options; none if nobody said yes/maybe. */
export function bestIds(opts: { id: number; votes: { yes: number; maybe: number } }[]): Set<number> {
  const max = Math.max(0, ...opts.map((o) => score(o.votes)));
  return new Set(max > 0 ? opts.filter((o) => score(o.votes) === max).map((o) => o.id) : []);
}

const dayLongFmt = new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
/** "Onsdag den 14. oktober 2026 · 09.00–10.00 (+1 dag)" (design §29, viewer's time zone). */
export function whenLong(startIso: string, endIso: string | null): string {
  const s = new Date(startIso);
  let out = `${cap(dayLongFmt.format(s))} · ${time.format(s)}`;
  if (endIso) { const e = new Date(endIso); out += '–' + time.format(e) + nextDayMarker(keyFmt.format(s), keyFmt.format(e)); }
  return out;
}

/** Google Calendar "add event" link (design §29). Times in UTC basic format; 1 h default like the .ics. */
export function googleCalendarUrl(o: { title: string; description?: string; start: string; end: string | null; url: string }): string {
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const s = new Date(o.start), e = o.end ? new Date(o.end) : new Date(s.getTime() + 3_600_000);
  const p = new URLSearchParams({ action: 'TEMPLATE', text: o.title, dates: `${f(s)}/${f(e)}`, details: [o.description, o.url].filter(Boolean).join('\n\n') });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

type AnyOpt = { date?: string | null; start_at: string | null; end_at: string | null };
/** Date polls: "Fre. 16. okt. 2026" (same in every time zone). Legacy timed polls: whenLabel (browser zone). */
export const optionLabel = (o: AnyOpt) => (o.date ? cap(formatDateShort(o.date)) : whenLabel(o.start_at!, o.end_at));
/** Result banner: "fre. 16. okt. 2026 (hele dagen)" / legacy whenLong. */
export const optionLong = (o: AnyOpt) => (o.date ? `${formatDateShort(o.date)} (hele dagen)` : whenLong(o.start_at!, o.end_at));
/** Google link for either kind: all-day dates=YYYYMMDD/YYYYMMDD(next day), else timed. */
export function googleCalendarUrlFor(o: AnyOpt, ev: { title: string; description?: string; url: string }): string {
  if (!o.date) return googleCalendarUrl({ ...ev, start: o.start_at!, end: o.end_at });
  const p = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates: `${basicDate(o.date)}/${basicDate(addDays(o.date, 1))}`, details: [ev.description, ev.url].filter(Boolean).join('\n\n') });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
