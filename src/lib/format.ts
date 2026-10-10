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
    out += '–' + (keyFmt.format(e) === keyFmt.format(s) ? time.format(e) : `${cap(dayShort.format(e))} ${time.format(e)}`);
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
