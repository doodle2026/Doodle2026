/**
 * Date-only polls: options are calendar dates 'YYYY-MM-DD' with no time zone. Pure + client-safe.
 * Rule: never build local `new Date(y, m, d)`; a date is the string, or `Date` at 00:00 UTC, formatted with timeZone 'UTC'.
 * So the same date renders identically in every process/browser time zone.
 */
export const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MAX_DATE_OPTIONS = 100;

/** Real calendar date (incl. leap years) in 'YYYY-MM-DD' form. */
export function isRealDate(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (y < 1970 || y > 9999) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}
export const toUtcDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const fromUtcDate = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => fromUtcDate(new Date(toUtcDate(s).getTime() + n * 86400_000));
/**
 * Earliest accepted date = UTC today − 1 day. Lenient on purpose: every place on earth (UTC−12 … UTC+14) has a
 * local "today" ≥ that, so no valid local today is ever rejected.
 */
export const minAllowedDate = (now = new Date()) => addDays(fromUtcDate(now), -1);

// Locale-aware formatting (design §45.5). Always timeZone 'UTC' on a UTC-midnight Date → same day everywhere.
export type DateLocale = 'en' | 'da' | 'fr' | 'de';
export const BCP: Record<DateLocale, string> = { en: 'en-US', da: 'da-DK', fr: 'fr-FR', de: 'de-DE' };
const cache = new Map<string, Intl.DateTimeFormat>();
function dtf(loc: DateLocale, o: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = loc + JSON.stringify(o);
  let f = cache.get(k);
  if (!f) cache.set(k, (f = new Intl.DateTimeFormat(BCP[loc] ?? 'en-US', { ...o, timeZone: 'UTC' })));
  return f;
}
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** 'Fri, Oct 16, 2026' / 'fre. 16. okt. 2026' / 'ven. 16 oct. 2026' / 'Fr., 16. Okt. 2026' */
export const formatDateShort = (s: string, loc: DateLocale = 'da') =>
  dtf(loc, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(toUtcDate(s));
/** 'Friday, October 16, 2026' / 'fredag 16. oktober 2026' (da without "den", as in mails) / 'vendredi 16 octobre 2026' / 'Freitag, 16. Oktober 2026' */
export const formatDateLong = (s: string, loc: DateLocale = 'da') =>
  dtf(loc, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(toUtcDate(s)).replace(' den ', ' ');
/** Span for OG/meta: 'October 14 – 22, 2026' / '14.–22. oktober 2026' … (Intl formatRange). */
export function formatSpan(dates: string[], loc: DateLocale = 'da'): string {
  if (!dates.length) return '';
  const d = [...dates].sort();
  const f = dtf(loc, { day: 'numeric', month: 'long', year: 'numeric' });
  return d[0] === d[d.length - 1] ? f.format(toUtcDate(d[0])) : f.formatRange(toUtcDate(d[0]), toUtcDate(d[d.length - 1]));
}
/** iCalendar / Google basic form 'YYYYMMDD'. */
export const basicDate = (s: string) => s.replaceAll('-', '');

// ---- Calendar math on 'YYYY-MM-DD' strings (UTC only; used by the date picker) ----
/** "Fredag 16. oktober 2026" – screen-reader label / chip remove label. */
export const formatDateLongCap = (s: string, loc: DateLocale = 'da') => cap(formatDateLong(s, loc));
/** "Oktober 2026" */
export const monthLabel = (s: string, loc: DateLocale = 'da') => cap(dtf(loc, { month: 'long', year: 'numeric' }).format(toUtcDate(s)));
/** Calendar head, Monday first in every locale (§45.5): ["Man", "Tir", …] from Intl. */
export const weekdayHeads = (loc: DateLocale = 'da', style: 'short' | 'long' = 'short') =>
  Array.from({ length: 7 }, (_, i) => dtf(loc, { weekday: style }).format(toUtcDate(`2024-01-0${i + 1}`)).replace(/\.$/, '')); // 2024-01-01 = Monday
/** Monday-based weekday 0..6. */
export const weekdayMon = (s: string) => (toUtcDate(s).getUTCDay() + 6) % 7;
export function addMonths(s: string, n: number): string {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return fromUtcDate(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last))));
}
export const firstOfMonth = (s: string) => `${s.slice(0, 7)}-01`;
export function dateRange(a: string, b: string): string[] {
  const [x, y] = a < b ? [a, b] : [b, a];
  const out: string[] = [];
  for (let c = x; c <= y; c = addDays(c, 1)) out.push(c);
  return out;
}
/** Today's date in the browser's own calendar (UI min). The server accepts ≥ UTC today − 1 day. */
export const localTodayIso = () => new Intl.DateTimeFormat('en-CA').format(new Date());
/** Column head: ["Fre.", "16. okt."] */
export const columnHead = (s: string, loc: DateLocale = 'da'): [string, string] =>
  [cap(dtf(loc, { weekday: 'short' }).format(toUtcDate(s))), dtf(loc, { day: 'numeric', month: 'short' }).format(toUtcDate(s))];
