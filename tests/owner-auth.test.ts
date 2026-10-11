/** Owner dashboard auth (PR A): argon2id, DB sessions, CSRF, throttling/lockout, audit log, headers, CLI. */
import { describe, test, expect, inject, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { hashPassword, truncateIp } from '../src/lib/owner/auth';

const BASE = inject('baseUrl');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
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

describe('owner auth API', () => {
  test('IPs truncated before storage: IPv4 /24, IPv6 /48', () => {
    expect(truncateIp('192.168.1.77')).toBe('192.168.1.xxx');
    expect(truncateIp('::ffff:10.0.0.5')).toBe('10.0.0.xxx');
    expect(truncateIp('2a02:aa7:4b1:12::1')).toBe('2a02:aa7:4b1::/48');
    expect(truncateIp('2a02:0aa7:04b1:0012:0:0:0:1')).toBe('2a02:aa7:4b1::/48');
    expect(truncateIp('::1')).toBe('0:0:0::/48');
    expect(truncateIp('nonsense')).toBe('unknown');
  });

  test('argon2id with OWASP parameters', async () => {
    expect(await hashPassword(PW)).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  test('login → HttpOnly SameSite=Strict session cookie, no token in body; me returns username + csrf; logout needs CSRF', async () => {
    const u = await mkUser(); const j = jar();
    const r = await login(j, u);
    expect(r.status).toBe(200); expect(r.body).toEqual({ ok: true });
    const sc = r.res.headers.getSetCookie().find((c) => c.startsWith('ga_owner='))!;
    expect(sc).toMatch(/HttpOnly/); expect(sc).toMatch(/SameSite=Strict/); expect(sc).toMatch(/Max-Age=43200/);
    expect(r.res.headers.get('cache-control')).toMatch(/no-store/); expect(r.res.headers.get('x-robots-tag')).toMatch(/noindex/);
    // DB stores only the hash of the id
    const raw = j.cookies.get('ga_owner')!; const id = raw.split('.')[0];
    expect(await prisma.ownerSession.count({ where: { idHash: id } })).toBe(0);
    expect(await prisma.ownerSession.count({ where: { user: { username: u } } })).toBe(1);
    const me = await req(j, '/api/owner/me');
    expect(me.status).toBe(200); expect(me.body.username).toBe(u); expect(me.body.csrf).toMatch(/^[\w-]{40,}$/);
    expect(me.text).not.toContain(id);
    expect((await req(j, '/api/owner/logout', { method: 'POST' })).status).toBe(403); // no CSRF token
    expect((await req(j, '/api/owner/logout', { method: 'POST', csrf: me.body.csrf, origin: 'https://evil.example' })).status).toBe(403);
    expect((await req(j, '/api/owner/logout', { method: 'POST', csrf: me.body.csrf })).status).toBe(200);
    expect(await prisma.ownerSession.count({ where: { user: { username: u } } })).toBe(0);
    j.cookies.set('ga_owner', raw); // replay the old cookie
    expect((await req(j, '/api/owner/me')).status).toBe(401);
  });

  test('unknown user and wrong password → identical 401; forged/unsigned cookies rejected', async () => {
    const u = await mkUser();
    const a = await login(jar(), u, 'wrong password!!');
    const b = await login(jar(), `nobody-${uniq()}`, 'wrong password!!');
    expect(a.status).toBe(401); expect(b.status).toBe(401); expect(a.body).toEqual(b.body);
    expect(a.body.errors).toEqual(['Forkert brugernavn eller password']);
    const j = jar(); j.cookies.set('ga_owner', `${'A'.repeat(43)}.${'B'.repeat(43)}`);
    expect((await req(j, '/api/owner/me')).status).toBe(401);
  });

  test('CSRF on login: missing/mismatched token or cross-origin → 403 (and audited)', async () => {
    const u = await mkUser(); const j = jar();
    expect((await login(j, u, PW, { csrf: 'x'.repeat(43) })).status).toBe(403);
    expect((await login(j, u, PW, { origin: 'https://evil.example' })).status).toBe(403);
    const j2 = jar(); // token but no pre-cookie
    const c = await req(jar(), '/api/owner/csrf');
    expect((await req(j2, '/api/owner/login', { method: 'POST', json: { username: u, password: PW }, csrf: c.body.csrf })).status).toBe(403);
    expect(await prisma.ownerLoginLog.count({ where: { username: u, outcome: 'bad_csrf' } })).toBe(3);
    expect((await req(j2, '/api/owner/login', { method: 'POST', headers: { 'Content-Type': 'text/plain' } })).status).toBe(415);
  });

  test('session rotation on login: the previous session id is destroyed', async () => {
    const u = await mkUser(); const j = jar();
    await login(j, u); const first = j.cookies.get('ga_owner')!;
    await login(j, u); const second = j.cookies.get('ga_owner')!;
    expect(second).not.toBe(first);
    expect(await prisma.ownerSession.count({ where: { user: { username: u } } })).toBe(1);
    const old = jar(); old.cookies.set('ga_owner', first);
    expect((await req(old, '/api/owner/me')).status).toBe(401);
  });

  test('idle (2 h) and absolute (12 h) expiry', async () => {
    const u = await mkUser(); const j = jar();
    await login(j, u);
    await prisma.ownerSession.updateMany({ where: { user: { username: u } }, data: { lastSeenAt: new Date(Date.now() - 2 * 3600_000 - 1000) } });
    expect((await req(j, '/api/owner/me')).status).toBe(401);
    expect(await prisma.ownerSession.count({ where: { user: { username: u } } })).toBe(0);
    await login(j, u);
    await prisma.ownerSession.updateMany({ where: { user: { username: u } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await req(j, '/api/owner/me')).status).toBe(401);
  });

  test('lockout: 5 failures per username (any IP) or per IP within 15 min → 429 + Retry-After, even with the right password', async () => {
    const u = await mkUser();
    for (let i = 0; i < 5; i++) expect((await login(jar(), u, `wrong-${i}-password`)).status).toBe(401);
    const r = await login(jar(), u);
    expect(r.status).toBe(429); expect(Number(r.res.headers.get('retry-after'))).toBeGreaterThan(800);
    expect(r.body.code).toBe('locked');
    // per IP, spread over different usernames
    const ip = ipGen(); const v = await mkUser();
    for (let i = 0; i < 5; i++) await login(jar(ip), `x-${uniq()}`, 'wrong password!!');
    expect((await login(jar(ip), v)).status).toBe(429);
    expect((await login(jar(), v)).status).toBe(200); // other IP, untouched user
    // window frees after 15 min
    await prisma.ownerLoginLog.updateMany({ where: { username: u }, data: { at: new Date(Date.now() - 16 * 60_000) } });
    expect((await login(jar(), u)).status).toBe(200);
  });

  test('audit log: success and failure with IP, UA, time – never the password', async () => {
    const u = await mkUser(); const j = jar();
    await login(j, u, 'nope nope nope!'); await login(j, u);
    const rows = await prisma.ownerLoginLog.findMany({ where: { username: u }, orderBy: { id: 'asc' } });
    expect(rows.map((r) => [r.success, r.outcome])).toEqual([[false, 'bad_credentials'], [true, 'ok']]);
    expect(rows.every((r) => r.ip === truncateIp(j.ip) && !r.ip.endsWith(j.ip.split('.')[3]) && r.userAgent === j.ua && r.at instanceof Date)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('nope nope'); expect(JSON.stringify(rows)).not.toContain(PW);
    expect((await prisma.ownerUser.findUnique({ where: { username: u } }))!.lastLoginAt).toBeInstanceOf(Date);
  });

  test('https: __Host- cookie with Secure', async () => {
    const u = await mkUser(); const j = jar();
    const c = await req(j, '/api/owner/csrf', { headers: { 'X-Forwarded-Proto': 'https' } });
    expect(c.res.headers.getSetCookie()[0]).toMatch(/^__Host-ga_owner_pre=.*; Path=\/; HttpOnly; SameSite=Strict; Secure/);
    const r = await req(j, '/api/owner/login', { method: 'POST', json: { username: u, password: PW }, csrf: c.body.csrf, headers: { 'X-Forwarded-Proto': 'https' }, origin: BASE });
    expect(r.status).toBe(200);
    expect(r.res.headers.getSetCookie().find((x) => x.startsWith('__Host-ga_owner='))).toMatch(/Secure/);
  });
});

describe('owner pages', () => {
  test('/<locale>/owner: noindex, no-store, no-referrer; without session → login; with session → page', async () => {
    for (const p of ['/da/owner/login', '/en/owner']) {
      const r = await fetch(BASE + p, { redirect: 'manual' });
      expect(r.headers.get('cache-control')).toMatch(/no-store/);
      expect(r.headers.get('x-robots-tag')).toMatch(/noindex/);
      expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    }
    const anon = await fetch(BASE + '/da/owner', { redirect: 'manual' });
    expect([303, 307, 308]).toContain(anon.status); expect(anon.headers.get('location')).toMatch(/\/da\/owner\/login(\?|$)/);
    const u = await mkUser(); const j = jar(); await login(j, u);
    const page = await req(j, '/da/owner');
    expect(page.status).toBe(200); expect(page.text).toContain(`Logget ind som <strong>${u}</strong>`);
    expect(page.text).not.toContain(j.cookies.get('ga_owner')!.split('.')[0]);
    const again = await req(j, '/da/owner/login'); expect(again.res.headers.get('location')).toMatch(/\/da\/owner$/);
  });

  test.skipIf(!existsSync(CHROME))('headless: login form (generic error, then success), logout', async () => {
    const { chromium } = await import('playwright-core');
    const b = await chromium.launch({ executablePath: CHROME });
    const u = await mkUser();
    const pg = await b.newPage({ extraHTTPHeaders: { 'X-Forwarded-For': ipGen() } });
    await pg.goto(`${BASE}/da/owner`); await pg.waitForURL(/\/da\/owner\/login(\?|$)/);
    await pg.fill('#owner-user', u); await pg.fill('#owner-pw', 'wrong password!!'); await pg.click('#owner-submit');
    await pg.waitForSelector('#owner-err >> text=Forkert brugernavn eller password');
    await pg.fill('#owner-pw', PW); await pg.click('#owner-submit');
    await pg.waitForURL(/\/da\/owner$/); await pg.waitForSelector('#owner-who');
    const ck = (await pg.context().cookies()).find((c) => c.name === 'ga_owner')!;
    expect(ck.httpOnly).toBe(true); expect(ck.sameSite).toBe('Strict');
    await pg.click('#owner-logout'); await pg.waitForURL(/\/da\/owner\/login(\?|$)/);
    await pg.goto(`${BASE}/da/owner`); await pg.waitForURL(/\/da\/owner\/login(\?|$)/);
    await b.close();
  });
});

describe('npm run owner:create', () => {
  const run = (args: string[], input: string) => spawnSync('node', ['scripts/owner-create.mjs', ...args], { input, encoding: 'utf8', env: process.env });
  test('creates an argon2id user from stdin (no TTY), refuses short passwords and duplicates, --reset logs out everywhere; never prints the password', async () => {
    const u = `cli-${uniq()}`; const pw = `cli-secret-${uniq()}-pw`;
    expect(run(['--username', u], 'short\n').status).toBe(1);
    const ok = run(['--username', u], `${pw}\n`);
    expect(ok.status).toBe(0); expect(ok.stdout + ok.stderr).not.toContain(pw);
    const row = (await prisma.ownerUser.findUnique({ where: { username: u } }))!;
    expect(row.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(run(['--username', u], `${pw}\n`).status).toBe(1);
    const j = jar(); expect((await login(j, u, pw)).status).toBe(200);
    const pw2 = `${pw}-2`;
    expect(run(['--username', u, '--reset'], `${pw2}\n`).status).toBe(0);
    expect((await req(j, '/api/owner/me')).status).toBe(401);
    expect((await login(jar(), u, pw2)).status).toBe(200);
  });
});
