import { addDays, basicDate } from './dates';
// Browser-side formatting helpers. Dates are plain 'YYYY-MM-DD' (whole days, same in every time zone).

/** Score for "★ Bedst": yes = 2, maybe = 1 (design §15.3). */
export const score = (v: { yes: number; maybe: number }) => v.yes * 2 + v.maybe;

/** Ids of the best options; none if nobody said yes/maybe. */
export function bestIds(opts: { id: number; votes: { yes: number; maybe: number } }[]): Set<number> {
  const max = Math.max(0, ...opts.map((o) => score(o.votes)));
  return new Set(max > 0 ? opts.filter((o) => score(o.votes) === max).map((o) => o.id) : []);
}

type Opt = { date: string };
/** Google Calendar all-day link: dates=YYYYMMDD/YYYYMMDD (next day). */
export function googleCalendarUrlFor(o: Opt, ev: { title: string; description?: string; url: string }): string {
  const p = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates: `${basicDate(o.date)}/${basicDate(addDays(o.date, 1))}`, details: [ev.description, ev.url].filter(Boolean).join('\n\n') });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
