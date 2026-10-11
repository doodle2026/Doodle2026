import { prisma } from '@/lib/db';

/** Day boundary for all owner stats = the mail quota's day: UTC (EmailQuota.day). */
export const DAY_TZ = 'UTC';
export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

export type StatKey = 'polls_deleted' | 'limit_poll' | 'limit_hour' | 'limit_ip' | 'limit_day' | 'self_sent';
/** ApiError codes → limit counter (PM: aggregated per type per day, no IP/email). */
export const LIMIT_CODES: Record<string, StatKey> = { too_many_per_poll: 'limit_poll', poll_hourly_limit: 'limit_hour', quota: 'limit_day', ip_limit: 'limit_ip', rate_ip: 'limit_ip' };

/** Increment an aggregate counter; never throws (stats must not break the request). */
export async function bumpStat(key: StatKey, by = 1) {
  try {
    await prisma.$executeRaw`INSERT INTO daily_stats (day, key, count) VALUES (${utcDay()}, ${key}, ${by})
      ON CONFLICT (day, key) DO UPDATE SET count = daily_stats.count + ${by}`;
  } catch { /* ignore */ }
}
/** Count a limit hit from an error payload's code (no-op for other codes). */
export const bumpLimit = (code: unknown) => (typeof code === 'string' && LIMIT_CODES[code] ? bumpStat(LIMIT_CODES[code]) : Promise.resolve());
