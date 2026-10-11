/** Owner dashboard stats/list/detail/log API (PR B). */
import { describe, test, expect, inject, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { hashPassword, truncateIp } from '../src/lib/owner/auth';
import { utcDay } from '../src/lib/owner/counters';

const BASE = inject('baseUrl');
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const uniq = () => Math.random().toString(36).slice(2, 10);
const ipGen = () => `10.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${(Math.random() * 250 + 1) | 0}`; // distinct /24 per jar (lockout is per truncated IP)
const PW = 'correct horse battery staple';

async function mkUser(pw = PW) {
  const username = `own-${uniq()}`;
  await prisma.ownerUser.create({ data: { username, passwordHash: await hashPassword(pw) } });
  return username;
}
type Jar = { cookies: Map<string, string>; ip: string; ua: string };
const jar = (ip = ipGen()): Jar => ({ cookies: new Map(), ip, ua: `vitest-${uniq()}` });
function store(j: Jar, res: Response) {
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) j.cookies.set(k, v); else j.cookies.delete(k); }
}
async function req(j: Jar, path: string, init: { method?: string; json?: unknown; csrf?: string; origin?: string | null; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'X-Forwarded-For': j.ip, 'User-Agent': j.ua, Cookie: [...j.cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...init.headers };
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  if (init.csrf) headers['X-CSRF-Token'] = init.csrf;
  if (init.origin !== null && init.method && init.method !== 'GET') headers.Origin = init.origin ?? BASE;
  const res = await fetch(BASE + path, { method: init.method ?? 'GET', headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined, redirect: 'manual' });
  store(j, res);
  const text = await res.text(); let body: any; try { body = JSON.parse(text); } catch { body = text; } // eslint-disable-line @typescript-eslint/no-explicit-any
  return { res, status: res.status, body, text };
}
async function login(j: Jar, username: string, password = PW, opts: { csrf?: string; origin?: string | null } = {}) {
  const c = await req(j, '/api/owner/csrf');
  return req(j, '/api/owner/login', { method: 'POST', json: { username, password }, csrf: opts.csrf ?? c.body.csrf, origin: opts.origin });
}


const Y = new Date().getUTCFullYear() + 1;
async function mkPoll(title: string, locale = 'da', dates = 2) {
  const r = await fetch(BASE + '/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ipGen() },
    body: JSON.stringify({ locale, title, options: Array.from({ length: dates }, (_, i) => ({ date: `${Y}-11-0${i + 1}` })) }) });
  const b = await r.json(); return { id: b.id as string, token: b.admin_token as string, body: b };
}
async function owner() { const u = await mkUser(); const j = jar(); await login(j, u); return { j, u }; }
const stat = async (key: string) => (await prisma.dailyStat.findUnique({ where: { day_key: { day: utcDay(), key } } }))?.count ?? 0;

describe('owner API (PR B)', () => {
  test('all owner endpoints require a session (401) and send no-store/noindex', async () => {
    for (const p of ['/api/owner/stats', '/api/owner/events', '/api/owner/events/abc', '/api/owner/log']) {
      const r = await req(jar(), p);
      expect(r.status).toBe(401); expect(r.res.headers.get('cache-control')).toMatch(/no-store/); expect(r.res.headers.get('x-robots-tag')).toMatch(/noindex/);
    }
  });

  test('stats: shape per §47.7, UTC day, cached 60 s, numbers only', async () => {
    const { j } = await owner();
    const a = await req(j, '/api/owner/stats');
    expect(a.status).toBe(200);
    const s = a.body;
    expect(s.dayTz).toBe('UTC'); expect(s.today).toBe(utcDay());
    expect(Object.keys(s.polls).sort()).toEqual(['closed', 'd30', 'd7', 'deleted', 'existing', 'open', 'today', 'total']);
    expect(s.polls.total).toBe(s.polls.existing + s.polls.deleted);
    expect(s.polls.open + s.polls.closed).toBe(s.polls.existing);
    expect(s.daily).toHaveLength(30); expect(s.daily[29].date).toBe(utcDay());
    expect(Object.keys(s.languages).sort()).toEqual(['da', 'de', 'en', 'fr']);
    expect(s.email).toMatchObject({ dailyLimit: expect.any(Number), sentToday: expect.any(Number) });
    expect(Object.keys(s.limits).sort()).toEqual(['day', 'hour', 'ip', 'poll']);
    expect(s.newest.length).toBeLessThanOrEqual(10);
    await mkPoll(`cache-${uniq()}`);
    const b = await req(j, '/api/owner/stats');
    expect(b.body.generatedAt).toBe(s.generatedAt); // cached
    expect(a.text).not.toMatch(/token|hash|@/i);
  });

  test('hard delete → only the aggregate counter remains; limit hits counted per type per day', async () => {
    const p = await mkPoll(`del-${uniq()}`);
    const before = await stat('polls_deleted');
    const d = await fetch(`${BASE}/api/events/${p.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${p.token}`, 'X-Forwarded-For': ipGen() } });
    expect(d.status).toBe(200);
    expect(await prisma.event.count({ where: { slug: p.id } })).toBe(0); // gone
    expect(await stat('polls_deleted')).toBe(before + 1);
    // 200 invitations exist → one more → too_many_per_poll → limit_poll +1
    const q = await mkPoll(`lim-${uniq()}`);
    const ev = (await prisma.event.findUnique({ where: { slug: q.id } }))!;
    await prisma.invitation.createMany({ data: Array.from({ length: 200 }, (_, i) => ({ eventId: ev.id, email: `l${i}-${uniq()}@example.com`, locale: 'da', linkTokenHash: `${uniq()}${uniq()}`.padEnd(64, '0').slice(0, 64), delivery: 'sent' })) });
    const lp = await stat('limit_poll');
    const r = await fetch(`${BASE}/api/events/${q.id}/invitations`, { method: 'POST', headers: { Authorization: `Bearer ${q.token}`, 'Content-Type': 'application/json', 'X-Forwarded-For': ipGen() }, body: JSON.stringify({ recipients: [`x-${uniq()}@example.com`] }) });
    expect(r.status).toBe(400);
    expect(await stat('limit_poll')).toBe(lp + 1);
    const rows = await prisma.dailyStat.findMany({ where: { day: utcDay() } });
    expect(JSON.stringify(rows)).not.toMatch(/@|\d+\.\d+\.\d+/); // no email/IP
  });

  test('event list: title search, partial case-insensitive email search (matchedEmail), filters, sort, 50 per page, no tokens', async () => {
    const tag = uniq();
    const a = await mkPoll(`Teammøde ${tag} A`, 'da', 3);
    const b = await mkPoll(`Teammøde ${tag} B`, 'fr', 1);
    const ev = (await prisma.event.findUnique({ where: { slug: b.id } }))!;
    await prisma.invitation.create({ data: { eventId: ev.id, email: `anna.${tag}@firma.dk`, locale: 'fr', linkTokenHash: `${tag}`.padEnd(64, 'a'), delivery: 'bounced' } });
    const { j } = await owner();
    const t = await req(j, `/api/owner/events?q=${encodeURIComponent(`teamMØDE ${tag}`)}`);
    expect(t.body.total).toBe(2); expect(t.body.pageSize).toBe(50);
    expect(t.text).not.toContain(a.token); expect(t.text).not.toMatch(/admin_?token|token_?hash|link_?token/i);
    const m = await req(j, `/api/owner/events?q=${encodeURIComponent(`ANNA.${tag.toUpperCase()}@FIRMA`)}`);
    expect(m.body.rows.map((r: { id: string }) => r.id)).toEqual([b.id]);
    expect(m.body.rows[0]).toMatchObject({ matchedEmail: `anna.${tag}@firma.dk`, invitesRejected: 1, locale: 'fr', dateCount: 1, status: 'open' });
    expect((await req(j, `/api/owner/events?q=${encodeURIComponent(`a.${tag}@`)}`)).body.total).toBe(1); // partial
    expect((await req(j, `/api/owner/events?q=${tag}&pl=fr`)).body.rows.map((r: { id: string }) => r.id)).toEqual([b.id]);
    expect((await req(j, `/api/owner/events?q=${tag}&status=closed`)).body.total).toBe(0);
    const asc = await req(j, `/api/owner/events?q=${tag}&sort=dateCount&dir=asc`);
    expect(asc.body.rows.map((r: { dateCount: number }) => r.dateCount)).toEqual([1, 3]);
    expect((await req(j, `/api/owner/events?q=${tag}&sort=title&dir=desc`)).body.rows[0].id).toBe(b.id);
    expect((await req(j, `/api/owner/events?q=%25`)).status).toBe(200); // LIKE wildcards escaped
    expect((await req(j, `/api/owner/events?sort=evil;drop&dir=x&page=-3`)).body.page).toBe(1);
    expect(t.body.deletedNotShown).toEqual(expect.any(Number));
  });

  test('detail: full emails + names + raw status + unsubscribed mark; never tokens; each view logged (who/what/when, no IP)', async () => {
    const p = await mkPoll(`Detalje ${uniq()}`);
    const ev = (await prisma.event.findUnique({ where: { slug: p.id }, include: { timeOptions: true } }))!;
    const vote = await fetch(`${BASE}/api/events/${p.id}/votes`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ipGen() }, body: JSON.stringify({ name: 'Bo', votes: ev.timeOptions.map((o) => ({ option_id: o.id, value: 'yes' })) }) });
    const vb = await vote.json(); expect(vote.status).toBeLessThan(300);
    await prisma.invitation.createMany({ data: [
      { eventId: ev.id, email: 'u@example.com', locale: 'da', linkTokenHash: uniq().padEnd(64, 'b'), delivery: 'unsub', deliveryBeforeUnsub: 'delivered' },
      { eventId: ev.id, email: 'b@example.com', locale: 'da', linkTokenHash: uniq().padEnd(64, 'c'), delivery: 'bounced' },
    ] });
    const { j, u } = await owner();
    const r = await req(j, `/api/owner/events/${p.id}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: p.id, status: 'open', publicUrl: expect.stringMatching(new RegExp(`/da/p/${p.id}$`)) });
    expect(r.body.options).toHaveLength(2); expect(r.body.options[0]).toMatchObject({ yes: 1, maybe: 0, no: 0 });
    expect(r.body.participants).toEqual([expect.objectContaining({ name: 'Bo', yes: 2 })]);
    expect(r.body.invitations).toHaveLength(2);
    expect(r.body.invitations).toEqual(expect.arrayContaining([
      expect.objectContaining({ email: 'u@example.com', status: 'sent', unsubscribed: true }),
      expect.objectContaining({ email: 'b@example.com', status: 'rejected', unsubscribed: false }),
    ]));
    for (const secret of [p.token, vb.edit_token, vb.editUrl].filter(Boolean)) expect(r.text).not.toContain(secret);
    expect(r.text).not.toMatch(/admin|edit_?token|hash|#inv=/i);
    const log = await prisma.ownerLoginLog.findFirst({ where: { outcome: 'view', eventSlug: p.id }, orderBy: { id: 'desc' } });
    expect(log).toMatchObject({ username: u, ip: '', success: true });
    expect(r.body.viewLogged.user).toBe(u);
    expect((await req(j, '/api/owner/events/nope-nope')).status).toBe(404);
  });

  test('activity log: logins + views, truncated IPs, type filter, 50 per page, read-only', async () => {
    const { j, u } = await owner();
    const p = await mkPoll(`Log ${uniq()}`);
    await req(j, `/api/owner/events/${p.id}`);
    await login(jar(), u, 'wrong password!!');
    const all = await req(j, '/api/owner/log');
    expect(all.body.pageSize).toBe(50); expect(all.body.retentionMonths).toBe(12);
    const mine = all.body.rows.filter((r: { user: string }) => r.user === u);
    expect(mine.map((r: { type: string }) => r.type)).toEqual(expect.arrayContaining(['login_ok', 'view', 'login_failed']));
    expect(mine.find((r: { type: string }) => r.type === 'view')).toMatchObject({ ip: null, event: { id: p.id } });
    expect(mine.find((r: { type: string }) => r.type === 'login_ok').ip).toBe(truncateIp(j.ip));
    expect(all.text).not.toMatch(/\d+\.\d+\.\d+\.\d+(?!x)/); // no full IPv4
    const views = await req(j, '/api/owner/log?type=view');
    expect(views.body.rows.every((r: { type: string }) => r.type === 'view')).toBe(true);
    expect((await req(j, '/api/owner/log', { method: 'POST', csrf: 'x' })).status).toBeGreaterThanOrEqual(403);
  });
});
