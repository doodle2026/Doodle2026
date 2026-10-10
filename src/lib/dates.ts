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

// ---- Calendar math on 'YYYY-MM-DD' strings (UTC only; used by the date picker) ----
const MONTH = new Intl.DateTimeFormat('da-DK', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const LONG_CAP = (s: string) => { const t = formatDateLong(s); return t.charAt(0).toUpperCase() + t.slice(1); };
/** "Fredag 16. oktober 2026" – screen-reader label / chip remove label. */
export const formatDateLongCap = LONG_CAP;
/** "Oktober 2026" */
export const monthLabel = (s: string) => { const t = MONTH.format(toUtcDate(s)); return t.charAt(0).toUpperCase() + t.slice(1); };
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
const WD = new Intl.DateTimeFormat('da-DK', { weekday: 'short', timeZone: 'UTC' });
const DM = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const columnHead = (s: string): [string, string] => { const w = WD.format(toUtcDate(s)); return [w.charAt(0).toUpperCase() + w.slice(1), DM.format(toUtcDate(s))]; };
