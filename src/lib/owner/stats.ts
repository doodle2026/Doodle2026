/**
 * Owner dashboard data (spec "Ejer-dashboard", design §47.7/§47.8). Prisma count/groupBy + a few raw SQL aggregates
 * directly on the existing tables; no tracking table. Results cached 60 s per process.
 * Never returns tokens, token hashes, link tokens or provider ids.
 * "Day" = UTC calendar day (same as the mail quota, EmailQuota.day) – DAY_TZ.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { DAY_TZ, utcDay } from './counters';

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; v: unknown }>();
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const c = cache.get(key); if (c && Date.now() - c.at < CACHE_MS) return c.v as T;
  const v = await fn(); cache.set(key, { at: Date.now(), v }); return v;
}
export const clearStatsCache = () => cache.clear();

const LOCALES = ['en', 'da', 'fr', 'de'] as const;
type Locale = (typeof LOCALES)[number];
const dayStart = (offsetDays = 0) => { const d = new Date(`${utcDay()}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() - offsetDays); return d; };
const dailyLimit = () => Number(process.env.EMAIL_DAILY_QUOTA) > 0 ? Number(process.env.EMAIL_DAILY_QUOTA) : 100;
const n = (x: unknown) => Number(x ?? 0);
const isoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export interface OwnerEventRow {
  id: string; title: string; createdAt: string; locale: string; status: 'open' | 'closed';
  dateCount: number; participants: number; invitesSent: number; invitesRejected: number; finalDate: string | null; matchedEmail?: string;
}

/** Invitation delivery → owner's raw status buckets. 'rejected' = bounced (incl. complaints, which arrive as bounced). */
const SENT = ['sent', 'delivered'];

export async function ownerStats() {
  return cached('stats', async () => {
    const [existing, deletedAgg, today, d7, d30, open, participants, votes, optionCount] = await Promise.all([
      prisma.event.count(),
      prisma.dailyStat.aggregate({ where: { key: 'polls_deleted' }, _sum: { count: true } }),
      prisma.event.count({ where: { createdAt: { gte: dayStart(0) } } }),
      prisma.event.count({ where: { createdAt: { gte: dayStart(6) } } }),
      prisma.event.count({ where: { createdAt: { gte: dayStart(29) } } }),
      prisma.event.count({ where: { closedAt: null } }),
      prisma.participant.count(),
      prisma.vote.count(),
      prisma.timeOption.count(),
    ]);
    const deleted = deletedAgg._sum.count ?? 0;
    // polls with ≥1 participant other than the organizer (name ≠ organizer name, case-insensitive)
    const [withPart] = await prisma.$queryRaw<{ c: bigint }[]>`SELECT count(*) AS c FROM events e WHERE EXISTS (
      SELECT 1 FROM participants p WHERE p.event_id = e.id AND lower(p.name) <> lower(coalesce(e.organizer_name, '')))`;
    const ttc = await prisma.$queryRaw<{ d: number }[]>`SELECT EXTRACT(EPOCH FROM (closed_at - created_at)) / 86400.0 AS d FROM events WHERE closed_at IS NOT NULL ORDER BY 1`;
    const days = ttc.map((r) => Number(r.d));
    const bucket = { lt1: 0, d1_3: 0, d4_7: 0, d8_14: 0, gt14: 0 };
    for (const d of days) bucket[d < 1 ? 'lt1' : d <= 3 ? 'd1_3' : d <= 7 ? 'd4_7' : d <= 14 ? 'd8_14' : 'gt14']++;
    const median = days.length ? (days.length % 2 ? days[(days.length - 1) / 2] : (days[days.length / 2 - 1] + days[days.length / 2]) / 2) : 0;
    const [evByLang, partByLang] = await Promise.all([
      prisma.event.groupBy({ by: ['locale'], _count: { _all: true } }),
      prisma.$queryRaw<{ locale: string; c: bigint }[]>`SELECT e.locale, count(p.id) AS c FROM participants p JOIN events e ON e.id = p.event_id GROUP BY e.locale`,
    ]);
    const languages = Object.fromEntries(LOCALES.map((l) => [l, {
      polls: evByLang.find((x) => x.locale === l)?._count._all ?? 0,
      participants: n(partByLang.find((x) => x.locale === l)?.c),
    }])) as Record<Locale, { polls: number; participants: number }>;
    const [quotaToday, deliveries, unsubscribes, limitsRows, splitRows, selfAll] = await Promise.all([
      prisma.emailQuota.findUnique({ where: { day: utcDay() } }),
      prisma.invitation.groupBy({ by: ['delivery'], _count: { _all: true } }),
      prisma.emailSuppression.count(),
      prisma.dailyStat.findMany({ where: { key: { startsWith: 'limit_' }, day: { gte: utcDay(dayStart(29)) } } }),
      prisma.dailyStat.findMany({ where: { key: { in: ['mail_inv', 'mail_rem', 'self_sent'] }, day: utcDay() } }),
      prisma.dailyStat.aggregate({ where: { key: 'self_sent' }, _sum: { count: true } }),
    ]);
    const dc = (ks: string[]) => deliveries.filter((d) => ks.includes(d.delivery)).reduce((a, d) => a + d._count._all, 0);
    const sp = (key: string) => splitRows.find((r) => r.key === key)?.count ?? 0;
    const lim = (key: string) => {
      const rows = limitsRows.filter((r) => r.key === key);
      const since = (k: number) => rows.filter((r) => r.day >= utcDay(dayStart(k))).reduce((a, r) => a + r.count, 0);
      return { today: since(0), d7: since(6), d30: since(29) };
    };
    // 30 UTC days: polls created + votes (= responses: participants created) per day
    const dailyRaw = await prisma.$queryRaw<{ day: string; polls: bigint; votes: bigint }[]>`
      SELECT to_char(d, 'YYYY-MM-DD') AS day,
        (SELECT count(*) FROM events e WHERE e.created_at >= d AND e.created_at < d + interval '1 day') AS polls,
        (SELECT count(*) FROM participants p WHERE p.created_at >= d AND p.created_at < d + interval '1 day') AS votes
      FROM generate_series(${dayStart(29)}::timestamptz, ${dayStart(0)}::timestamptz, interval '1 day') AS d ORDER BY d`;
    const newest = (await listEvents({ sort: 'createdAt', dir: 'desc', page: 1, pageSize: 10 })).rows;
    return {
      generatedAt: new Date().toISOString(), dayTz: DAY_TZ, today: utcDay(),
      polls: { total: existing + deleted, existing, today, d7, d30, open, closed: existing - open, deleted },
      participation: { participants, votes, avgPerPoll: existing ? participants / existing : 0, shareWithParticipant: existing ? n(withPart?.c) / existing : 0 },
      dates: { avgPerPoll: existing ? optionCount / existing : 0, timeToClose: { ...bucket, medianDays: Math.round(median * 10) / 10 } },
      languages,
      email: { sentToday: quotaToday?.count ?? 0, dailyLimit: dailyLimit(), sent: dc(SENT), failed: dc(['failed']), rejected: dc(['bounced']), unsubscribes,
        // §47.9: main number = ALL mails today (every type reserves the shared Resend quota); split + all-time self count (no addresses)
        split: { inv: sp('mail_inv'), rem: sp('mail_rem'), self: sp('self_sent') }, selfTotal: selfAll._sum.count ?? 0 },
      limits: { poll: lim('limit_poll'), hour: lim('limit_hour'), ip: lim('limit_ip'), day: lim('limit_day') },
      daily: dailyRaw.map((r) => ({ date: r.day, polls: n(r.polls), votes: n(r.votes) })),
      newest,
    };
  });
}

// ---------------- event list ----------------
export const SORTS = { title: Prisma.sql`lower(e.title)`, createdAt: Prisma.sql`e.created_at`, locale: Prisma.sql`e.locale`, status: Prisma.sql`(e.closed_at IS NOT NULL)`,
  dateCount: Prisma.sql`date_count`, participants: Prisma.sql`participants`, invitesSent: Prisma.sql`invites_sent`, invitesRejected: Prisma.sql`invites_rejected`, finalDate: Prisma.sql`final_date` } as const;
export type ListQuery = { q?: string; status?: string; pl?: string; period?: string; sort?: string; dir?: string; page?: number; pageSize?: number };
const PERIODS: Record<string, number> = { today: 0, '7': 6, '30': 29, '90': 89 };
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listEvents(qIn: ListQuery) {
  const pageSize = qIn.pageSize ?? 50;
  let page = Math.max(1, Math.min(10_000, Math.floor(Number(qIn.page) || 1)));
  const q = (qIn.q ?? '').trim().slice(0, 200);
  const emailSearch = q.includes('@');
  const like = `%${likeEscape(q.toLowerCase())}%`;
  const where: Prisma.Sql[] = [];
  if (q) where.push(emailSearch
    ? Prisma.sql`EXISTS (SELECT 1 FROM invitations i WHERE i.event_id = e.id AND i.email ILIKE ${like})`
    : Prisma.sql`e.title ILIKE ${like}`);
  if (qIn.status === 'open') where.push(Prisma.sql`e.closed_at IS NULL`);
  if (qIn.status === 'closed') where.push(Prisma.sql`e.closed_at IS NOT NULL`);
  if (qIn.pl && (LOCALES as readonly string[]).includes(qIn.pl)) where.push(Prisma.sql`e.locale = ${qIn.pl}`);
  if (qIn.period && qIn.period in PERIODS) where.push(Prisma.sql`e.created_at >= ${dayStart(PERIODS[qIn.period])}`);
  const W = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
  const sortKey = (qIn.sort && qIn.sort in SORTS ? qIn.sort : 'createdAt') as keyof typeof SORTS;
  const dir = qIn.dir === 'asc' ? Prisma.sql`ASC` : qIn.dir === 'desc' ? Prisma.sql`DESC` : ['title', 'locale'].includes(sortKey) ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const [{ c: total }] = await prisma.$queryRaw<{ c: bigint }[]>`SELECT count(*) AS c FROM events e ${W}`;
  page = Math.min(page, Math.max(1, Math.ceil(n(total) / pageSize))); // L4: clamp out-of-range ?page to the last page
  const rows = await prisma.$queryRaw<{ slug: string; title: string; created_at: Date; locale: string; closed: boolean; date_count: bigint; participants: bigint;
    invites_sent: bigint; invites_rejected: bigint; final_date: Date | null; matched: string | null }[]>`
    SELECT e.slug, e.title, e.created_at, e.locale, (e.closed_at IS NOT NULL) AS closed,
      (SELECT count(*) FROM time_options o WHERE o.event_id = e.id) AS date_count,
      (SELECT count(*) FROM participants p WHERE p.event_id = e.id) AS participants,
      (SELECT count(*) FROM invitations i WHERE i.event_id = e.id AND i.delivery IN ('sent', 'delivered')) AS invites_sent,
      (SELECT count(*) FROM invitations i WHERE i.event_id = e.id AND i.delivery = 'bounced') AS invites_rejected,
      (SELECT o.date FROM time_options o WHERE o.id = e.chosen_option_id) AS final_date,
      ${emailSearch && q ? Prisma.sql`(SELECT i.email FROM invitations i WHERE i.event_id = e.id AND i.email ILIKE ${like} ORDER BY i.email LIMIT 1)` : Prisma.sql`NULL`} AS matched
    FROM events e ${W}
    ORDER BY ${SORTS[sortKey]} ${dir} NULLS LAST, e.id DESC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
  const [{ s: deletedCount }] = await prisma.$queryRaw<{ s: bigint | null }[]>`SELECT sum(count) AS s FROM daily_stats WHERE key = 'polls_deleted'`;
  return {
    rows: rows.map((r): OwnerEventRow => ({
      id: r.slug, title: r.title, createdAt: r.created_at.toISOString(), locale: r.locale, status: r.closed ? 'closed' : 'open',
      dateCount: n(r.date_count), participants: n(r.participants), invitesSent: n(r.invites_sent), invitesRejected: n(r.invites_rejected),
      finalDate: isoDate(r.final_date), ...(r.matched ? { matchedEmail: r.matched } : {}),
    })),
    total: n(total), page, pageSize, deletedNotShown: n(deletedCount), dayTz: DAY_TZ,
  };
}

// ---------------- detail ----------------
export async function eventDetail(slug: string) {
  const e = await prisma.event.findUnique({
    where: { slug },
    select: {
      id: true, slug: true, title: true, description: true, locale: true, createdAt: true, closedAt: true, inviteTracking: true,
      remindersSent: true, lastReminderAt: true, _count: { select: { selfSends: true } }, chosenOption: { select: { date: true } },
      timeOptions: { orderBy: { date: 'asc' }, select: { id: true, date: true, votes: { select: { value: true } } } },
      participants: { orderBy: { createdAt: 'asc' }, select: { name: true, createdAt: true, updatedAt: true, votes: { select: { value: true } } } },
      invitations: { orderBy: { createdAt: 'asc' }, select: { email: true, delivery: true, deliveryBeforeUnsub: true, participantId: true, lastEventAt: true, createdAt: true } },
    },
  });
  if (!e) return null;
  const count = (vs: { value: string }[], v: string) => vs.filter((x) => x.value === v).length;
  const finalDate = isoDate(e.chosenOption?.date);
  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const raw = (i: { delivery: string; deliveryBeforeUnsub: string | null; participantId: number | null }) => {
    const d = i.delivery === 'unsub' ? i.deliveryBeforeUnsub ?? 'sent' : i.delivery;
    if (i.participantId) return 'answered';
    return d === 'bounced' ? 'rejected' : d === 'failed' ? 'failed' : 'sent';
  };
  const timeline: { type: string; at: string; n?: number; date?: string }[] = [{ type: 'created', at: e.createdAt.toISOString() }];
  if (e.invitations.length) timeline.push({ type: 'invites', at: e.invitations[0].createdAt.toISOString(), n: e.invitations.length });
  if (e.participants.length) timeline.push({ type: 'votes', at: e.participants[e.participants.length - 1].updatedAt.toISOString(), n: e.participants.length });
  if (e.lastReminderAt) timeline.push({ type: 'reminder', at: e.lastReminderAt.toISOString(), n: e.remindersSent });
  if (e.closedAt) timeline.push({ type: 'closed', at: e.closedAt.toISOString(), ...(finalDate ? { date: finalDate } : {}) });
  timeline.sort((a, b) => a.at.localeCompare(b.at));
  return {
    id: e.slug, title: e.title, description: e.description, locale: e.locale, status: e.closedAt ? 'closed' : 'open',
    createdAt: e.createdAt.toISOString(), closedAt: e.closedAt?.toISOString() ?? null, tracking: e.inviteTracking, finalDate,
    selfSent: e._count.selfSends, // "Send til mig selv": only the number (no address is stored)
    publicUrl: `${appUrl}/${e.locale}/p/${e.slug}`, // the only link – never admin/edit/invite links
    purgeAt: e.closedAt ? new Date(e.closedAt.getTime() + 90 * 86400_000).toISOString() : null,
    options: e.timeOptions.map((o) => ({ date: isoDate(o.date)!, yes: count(o.votes, 'yes'), maybe: count(o.votes, 'maybe'), no: count(o.votes, 'no'), final: isoDate(o.date) === finalDate })),
    participants: e.participants.map((p) => ({ name: p.name, answeredAt: p.updatedAt.toISOString(), yes: count(p.votes, 'yes'), maybe: count(p.votes, 'maybe'), no: count(p.votes, 'no') })),
    invitations: e.invitations.map((i) => ({ email: i.email, status: raw(i), unsubscribed: i.delivery === 'unsub', updatedAt: i.lastEventAt.toISOString() })),
    timeline,
  };
}

// ---------------- activity log ----------------
export const LOG_TYPES: Record<string, string[]> = { login_ok: ['ok'], login_failed: ['bad_credentials', 'bad_csrf'], locked: ['locked'], logout: ['logout'], view: ['view'], unlock: ['unlock'] };
export async function activityLog(type: string | undefined, pageIn: unknown) {
  const pageSize = 50;
  const where = type && LOG_TYPES[type] ? { outcome: { in: LOG_TYPES[type] } } : {};
  const total = await prisma.ownerLoginLog.count({ where });
  const page = Math.min(Math.max(1, Math.floor(Number(pageIn) || 1)), Math.max(1, Math.ceil(total / pageSize))); // L4: clamp
  const rows = await prisma.ownerLoginLog.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * pageSize, take: pageSize });
  const typeOf = (o: string) => Object.entries(LOG_TYPES).find(([, v]) => v.includes(o))?.[0] ?? o;
  const userIds = [...new Set(rows.map((r) => r.userId).filter((x): x is number => x !== null))];
  const users = new Map((await prisma.ownerUser.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } })).map((u) => [u.id, u.username]));
  const slugs = [...new Set(rows.map((r) => r.eventSlug).filter((x): x is string => !!x))];
  const titles = new Map((await prisma.event.findMany({ where: { slug: { in: slugs } }, select: { slug: true, title: true } })).map((e) => [e.slug, e.title]));
  return {
    rows: rows.map((r) => ({
      at: r.at.toISOString(), type: typeOf(r.outcome),
      // failed logins: the attempted name (spec: shown if unknown); known users by their username
      user: r.userId ? users.get(r.userId) ?? r.username : r.username,
      known: r.userId !== null,
      ip: r.ip || null, // already truncated at write time; views have none
      event: r.eventSlug ? { id: r.eventSlug, title: titles.get(r.eventSlug) ?? null } : null, // title null = poll deleted since
      ...(r.outcome === 'bad_csrf' ? { detail: 'csrf' } : {}),
    })),
    total, page, pageSize, retentionMonths: 12,
  };
}

export async function logView(userId: number, username: string, slug: string) {
  await prisma.ownerLoginLog.create({ data: { username, userId, success: true, outcome: 'view', ip: '', userAgent: '', eventSlug: slug } });
}
