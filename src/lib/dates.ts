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

const SHORT = new Intl.DateTimeFormat('da-DK', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const LONG = new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
/** 'fre. 16. okt. 2026' */
export const formatDateShort = (s: string) => SHORT.format(toUtcDate(s));
/** 'fredag 16. oktober 2026' */
export const formatDateLong = (s: string) => LONG.format(toUtcDate(s)).replace(' den ', ' ');
/** iCalendar / Google basic form 'YYYYMMDD'. */
export const basicDate = (s: string) => s.replaceAll('-', '');
