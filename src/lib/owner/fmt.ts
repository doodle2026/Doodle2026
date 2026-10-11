/** Owner UI formatting (pure; server + client). Timestamps shown in UTC (= DAY_TZ) so "day" is unambiguous. */
import { INTL_TAG, type Locale } from '@/i18n/config';

export function ownerFmt(locale: Locale) {
  const B = INTL_TAG[locale];
  const nf = new Intl.NumberFormat(B);
  const pf = new Intl.NumberFormat(B, { style: 'percent', maximumFractionDigits: 0 });
  const df1 = new Intl.NumberFormat(B, { maximumFractionDigits: 1 });
  const dt = new Intl.DateTimeFormat(B, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' });
  const tm = new Intl.DateTimeFormat(B, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' });
  const date = new Intl.DateTimeFormat(B, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const short = new Intl.DateTimeFormat(B, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const d = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
  return {
    n: (x: number) => nf.format(x), pct: (x: number) => pf.format(x), d1: (x: number) => df1.format(x),
    dt: (s: string) => dt.format(d(s)), time: (s: string) => tm.format(d(s)), date: (s: string) => date.format(d(s)), short: (s: string) => short.format(d(s)),
    /** Local (Europe/Copenhagen) wall time of the next UTC midnight, for the "day = UTC" rule. */
    resetLocal: (now = new Date()) => {
      const mid = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
      const tz = 'Europe/Copenhagen';
      const time = new Intl.DateTimeFormat(B, { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(mid);
      const name = new Intl.DateTimeFormat(B, { timeZone: tz, timeZoneName: 'short' }).formatToParts(mid).find((p) => p.type === 'timeZoneName')?.value ?? tz;
      return { time, name };
    },
  };
}
