/**
 * LEGACY timed polls (events.mode = 'datetime', created before date-only). Everything time-zone related lives
 * here so it can be deleted once legacy polls are retired. New polls never use this.
 */
export interface DesignOption { date: string; start: string; end: string | null; end_date?: string }

export function resolveZone(tz: unknown): string {
  if (typeof tz === 'string' && tz.length > 0 && tz.length <= 64) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { /* invalid → UTC */ }
  }
  return 'UTC';
}

/** options[{date,start,end}] as wall-clock time in an IANA zone (default UTC). */
export function legacyDesignOptions(opts: { start_at: string | null; end_at: string | null }[], tz?: string | null) {
  const zone = resolveZone(tz);
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const parts = (iso: string) => {
    const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  };
  const options = opts.filter((o) => o.start_at).map((o): DesignOption => {
    const s = parts(o.start_at!);
    const e = o.end_at ? parts(o.end_at) : null;
    return { date: s.date, start: s.time, end: e ? e.time : null, ...(e && e.date !== s.date ? { end_date: e.date } : {}) };
  });
  return { zone, options };
}
