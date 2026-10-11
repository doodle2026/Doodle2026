/** Owner follow-ups: L1 expiry reason, L2 lock expiry re-enables the form, L3 scroll hint on iPad, L4 ?page clamp. */
import { describe, test, expect, inject, afterAll, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { hashPassword, truncateIp } from '../src/lib/owner/auth';
import { existsSync } from 'node:fs';
import * as pwc from 'playwright-core';

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


const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const avail = (b: string) => { try { return existsSync((pwc as unknown as Record<string, { executablePath(): string }>)[b].executablePath()); } catch { return false; } };
const DEVICES: { id: string; browser: 'chromium' | 'firefox' | 'webkit'; device?: string; viewport?: { width: number; height: number } }[] = [
  { id: 'iphone-14', browser: 'webkit', device: 'iPhone 14' },
  { id: 'pixel-7', browser: 'chromium', device: 'Pixel 7' },
  { id: 'ipad-gen7', browser: 'webkit', device: 'iPad (gen 7)' },
  { id: 'desktop-chromium', browser: 'chromium', viewport: { width: 1280, height: 900 } },
  { id: 'desktop-firefox', browser: 'firefox', viewport: { width: 1280, height: 900 } },
  { id: 'webkit-320', browser: 'webkit', device: 'iPhone SE', viewport: { width: 320, height: 640 } },
];
const AUDIT = () => {
  const r: string[] = [];
  document.querySelectorAll('button,.btn').forEach((e) => { const el = e as HTMLElement; if (el.offsetParent && el.scrollWidth > el.clientWidth + 1) r.push('overflow:' + el.textContent!.trim().slice(0, 20)); });
  document.querySelectorAll('.card:not(.ocard-table):not(.ocharts)').forEach((e) => { if (e.scrollWidth > e.clientWidth + 1) r.push('card-overflow:' + e.className + ':' + e.textContent!.slice(0, 30)); });
  if (document.documentElement.scrollWidth > innerWidth + 1) r.push('page-hscroll');
  return [...new Set(r)].slice(0, 8);
};
async function ctxFor(b: pwc.Browser, opts: Record<string, unknown> = {}) {
  const u = await mkUser(); const j = jar(); await login(j, u);
  const ctx = await b.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': ipGen() }, ...opts });
  await ctx.addCookies([{ name: 'ga_owner', value: j.cookies.get('ga_owner')!, url: BASE }]);
  return { ctx, u };
}


const loc = async (j: ReturnType<typeof jar>, p: string) => (await req(j, p)).res.headers.get('location') ?? '';

describe('owner follow-ups', () => {
  test('L1: login redirect says why the session ended (idle / absolute / ended)', async () => {
    const u = await mkUser(); const j = jar();
    await login(j, u);
    await prisma.ownerSession.updateMany({ where: { user: { username: u } }, data: { lastSeenAt: new Date(Date.now() - 2 * 3600_000 - 1000) } });
    expect(await loc(j, '/da/owner')).toMatch(/expired=idle$/);
    expect(await loc(j, '/da/owner')).toMatch(/expired=ended$/); // row is gone now
    await login(j, u);
    await prisma.ownerSession.updateMany({ where: { user: { username: u } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await loc(j, '/da/owner/log')).toMatch(/expired=absolute$/);
    await login(j, u);
    await prisma.ownerSession.deleteMany({ where: { user: { username: u } } }); // logged out elsewhere / --reset
    expect(await loc(j, '/da/owner')).toMatch(/expired=ended$/);
    expect(await loc(jar(), '/da/owner')).not.toMatch(/expired/); // no cookie at all → plain login
    const page = await req(jar(), '/en/owner/login?expired=idle');
    expect(page.text).toContain('after 2 hours without activity');
    expect((await req(jar(), '/en/owner/login?expired=absolute')).text).toContain('12 hours');
    expect((await req(jar(), '/en/owner/login?expired=ended')).text).toContain('session has ended');
  });

  test('L4: out-of-range ?page is clamped to the last page (list and log)', async () => {
    const tag = uniq(); await mkPoll(`Clamp ${tag}`);
    const { j } = { j: jar() }; const u = await mkUser(); await login(j, u);
    expect(await loc(j, `/da/owner/events?q=${tag}&page=99`)).toBe(`/da/owner/events?q=${tag}`);
    const total = await prisma.ownerLoginLog.count(); const last = Math.max(1, Math.ceil(total / 50));
    const l = await loc(j, '/da/owner/log?page=99999');
    expect(l).toBe(last > 1 ? `/da/owner/log?page=${last}` : '/da/owner/log');
    expect((await req(j, '/api/owner/events?page=99999')).body.page).toBeLessThan(99999);
  });

  describe.skipIf(!existsSync(CHROME))('browser', () => {
    test('L2: after the lock expires the form re-enables without reload; focus never on <body>', async () => {
      const b = await pwc.chromium.launch({ executablePath: CHROME });
      try {
        const u = await mkUser();
        for (let i = 0; i < 5; i++) await login(jar(), u, `wrong-${i}-password`);
        // make the lock end in ~4 s: move the failures to the edge of the 15-min window
        await prisma.ownerLoginLog.updateMany({ where: { username: u, success: false }, data: { at: new Date(Date.now() - 15 * 60_000 + 4000) } });
        const ctx = await b.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': ipGen() } }); const pg = await ctx.newPage();
        await pg.goto(`${BASE}/en/owner/login`);
        await pg.fill('#owner-user', u); await pg.fill('#owner-pw', PW); await pg.click('#owner-submit');
        await pg.waitForSelector('#owner-err >> text=less than 1 min');
        expect(await pg.isDisabled('#owner-pw')).toBe(true);
        expect(await pg.evaluate(() => document.activeElement?.id)).toBe('ol-msg');
        await pg.waitForFunction(() => !(document.getElementById('owner-pw') as HTMLInputElement).disabled, null, { timeout: 15_000 });
        expect(await pg.locator('#owner-err').count()).toBe(0);
        await expect.poll(() => pg.evaluate(() => document.activeElement?.id)).toBe('owner-pw');
        await pg.fill('#owner-pw', PW); await pg.click('#owner-submit');
        await pg.waitForURL(/\/en\/owner$/);
        await ctx.close();
      } finally { await b.close(); }
    }, 60_000);

    test('L3: iPad shows a horizontal-scroll hint + focusable region for the polls table; desktop does not', async () => {
      const tag = uniq(); await mkPoll(`Scroll ${tag}`);
      const results: Record<string, boolean> = {};
      for (const [name, br, opts] of [['ipad', 'webkit', { ...pwc.devices['iPad (gen 7)'] }], ['desktop', 'chromium', { viewport: { width: 1280, height: 900 } }]] as const) {
        if (br === 'webkit' && !existsSync(pwc.webkit.executablePath())) continue;
        const b = br === 'webkit' ? await pwc.webkit.launch() : await pwc.chromium.launch({ executablePath: CHROME });
        try {
          const { ctx } = await ctxFor(b, opts as Record<string, unknown>); const pg = await ctx.newPage();
          await pg.goto(`${BASE}/da/owner/events?q=${tag}`); await pg.waitForLoadState('networkidle');
          results[name] = await pg.locator('#o-scroll-hint').isVisible().catch(() => false);
          if (name === 'ipad') {
            expect(await pg.getAttribute('.ocard-table', 'tabindex')).toBe('0');
            expect(await pg.getAttribute('.ocard-table', 'aria-label')).toMatch(/rul til siden/i);
            await pg.locator('.ocard-table').evaluate((e) => { e.scrollLeft = e.scrollWidth; });
            await expect.poll(() => pg.locator('#o-scroll-hint').isVisible()).toBe(false);
          }
          await ctx.close();
        } finally { await b.close(); }
      }
      if ('ipad' in results) expect(results.ipad).toBe(true);
      expect(results.desktop).toBe(false);
    }, 90_000);
  });
});
