/** Owner dashboard UI (PR C, design §47): pages, URL state, UTC labels, hard-delete counter, no tokens, device matrix. */
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

describe.skipIf(!existsSync(CHROME))('owner UI (§47)', () => {
  let b: pwc.Browser; const tag = uniq(); let A: { id: string; token: string }, B: { id: string; token: string };
  beforeAll(async () => {
    b = await pwc.chromium.launch({ executablePath: CHROME });
    A = await mkPoll(`Sommerfest ${tag}`, 'da'); B = await mkPoll(`Weihnachtsfeier ${tag}`, 'de');
    const ev = (await prisma.event.findUnique({ where: { slug: B.id } }))!;
    await prisma.invitation.create({ data: { eventId: ev.id, email: `Mette.${tag}@kunde.dk`.toLowerCase(), locale: 'de', linkTokenHash: tag.padEnd(64, 'e'), delivery: 'unsub', deliveryBeforeUnsub: 'delivered' } });
  });
  afterAll(async () => { await b?.close(); });

  test('no session → login with ?next=; validation, generic error, success returns to next', async () => {
    const ctx = await b.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': ipGen() } }); const pg = await ctx.newPage();
    const u = await mkUser();
    await pg.goto(`${BASE}/en/owner/events?pl=de`);
    await pg.waitForURL(/\/en\/owner\/login\?next=%2Fen%2Fowner%2Fevents%3Fpl%3Dde/);
    await pg.click('#owner-submit');
    await expect.poll(() => pg.textContent('#ol-user-err')).toBe('Enter your username.');
    expect(await pg.getAttribute('#owner-user', 'aria-invalid')).toBe('true');
    await pg.fill('#owner-user', u); await pg.fill('#owner-pw', 'wrong password!!'); await pg.click('#owner-submit');
    await pg.waitForSelector('#owner-err >> text=Wrong username or password');
    expect(await pg.inputValue('#owner-pw')).toBe('');
    await pg.click('.pw-toggle'); expect(await pg.getAttribute('#owner-pw', 'type')).toBe('text');
    await pg.fill('#owner-pw', PW); await pg.click('#owner-submit');
    await pg.waitForURL(/\/en\/owner\/events\?pl=de$/);
    await pg.click('#owner-logout'); await pg.waitForURL(/login\?out=1/);
    await pg.waitForSelector('.owner-msg--info >> text=logged out');
    await pg.goto(`${BASE}/en/owner/login?next=https://evil.example/x`);
    expect(await pg.getAttribute('#ol-form', 'id')).toBe('ol-form');
    await ctx.close();
  });

  test('dashboard: UTC labels everywhere, deleted only as counter (no link), nav, newest', async () => {
    const { ctx, u } = await ctxFor(b); const pg = await ctx.newPage();
    const res = await pg.goto(`${BASE}/da/owner`);
    expect(res!.headers()['x-robots-tag']).toMatch(/noindex/);
    expect(await pg.textContent('#o-today')).toMatch(/i dag \(UTC\)/);
    expect(await pg.textContent('#o-mail-tz')).toBe('(UTC)');
    expect(await pg.textContent('#o-dayrule')).toMatch(/UTC/);
    expect(await pg.textContent('#o-limits thead')).toMatch(/\(UTC\)/);
    expect(await pg.locator('#o-deleted a').count()).toBe(0);
    expect(await pg.textContent('#o-deleted')).toMatch(/hard delete|kun en tæller|Kun/i);
    expect(await pg.getAttribute('.owner-nav a[aria-current="page"]', 'href')).toBe('/da/owner');
    expect(await pg.textContent('#owner-who')).toContain(u);
    expect(await pg.locator('#o-newest tbody tr').count()).toBeGreaterThan(0);
    expect(await pg.locator('.ochart svg').count()).toBe(2);
    const html = await pg.content(); expect(html).not.toContain(A.token); expect(html).not.toMatch(/admin_token|editToken|#inv=/);
    await ctx.close();
  });

  test('events: URL state, title + partial email search with <mark>, filters, sort links, detail + log', async () => {
    const { ctx, u } = await ctxFor(b); const pg = await ctx.newPage();
    await pg.goto(`${BASE}/da/owner/events`);
    await pg.fill('#f-q', tag);
    await pg.waitForURL(new RegExp(`\\?q=${tag}$`));
    await expect.poll(() => pg.locator('#o-events tbody tr').count()).toBe(2);
    await pg.selectOption('#f-lang', 'de');
    await pg.waitForURL(/pl=de/);
    await expect.poll(() => pg.locator('#o-events tbody tr').count()).toBe(1);
    await pg.goto(`${BASE}/da/owner/events?q=${encodeURIComponent(`METTE.${tag.toUpperCase()}@KUNDE`)}`);
    expect(await pg.textContent('#o-events tbody mark')).toBe(`mette.${tag}@kunde.dk`);
    await pg.goto(`${BASE}/da/owner/events?q=${tag}`);
    await pg.click('a[data-sort="title"]'); await pg.waitForURL(/sort=title&dir=asc/);
    expect(await pg.getAttribute('th[aria-sort="ascending"] a', 'data-sort')).toBe('title');
    expect(await pg.textContent('#o-events tbody tr:first-child th')).toContain('Sommerfest');
    expect(await pg.textContent('#f-period')).toContain('(UTC)');
    // detail
    await pg.click(`a[href="/da/owner/events/${B.id}"]`); await pg.waitForURL(new RegExp(`/da/owner/events/${B.id}$`));
    expect(await pg.textContent('#o-inv')).toContain(`mette.${tag}@kunde.dk`);
    expect(await pg.locator('#o-inv .ost--unsub').count()).toBe(1);
    expect(await pg.getAttribute('#o-public', 'href')).toMatch(new RegExp(`/de/p/${B.id}$`));
    expect(await pg.textContent('#o-viewlogged')).toContain(u);
    const html = await pg.content(); expect(html).not.toContain(B.token); expect(html).not.toMatch(/\/admin|#inv=|editToken/);
    await pg.goto(`${BASE}/da/owner/events/doesnotexist`); await pg.waitForSelector('#o-notfound');
    // log: the view above appears, filter by type keeps URL state
    await pg.goto(`${BASE}/da/owner/log`);
    await pg.selectOption('#f-type', 'view'); await pg.waitForURL(/\/log\?type=view$/);
    await expect.poll(async () => (await pg.locator('#o-log tbody tr').allTextContents()).some((x) => x.includes(`Weihnachtsfeier ${tag}`) && x.includes(u))).toBe(true);
    expect(await pg.locator('#o-log tbody tr:not([data-type="view"])').count()).toBe(0);
    await ctx.close();
  });

  for (const d of DEVICES) {
    test.skipIf(!avail(d.browser))(`${d.id}: owner pages (en, de, da) – no overflow, tables become cards on phones`, async () => {
      const br = d.browser === 'chromium' ? b : await pwc[d.browser].launch();
      const dev = d.device ? { ...pwc.devices[d.device] } : {};
      if (d.browser === 'firefox') delete (dev as { isMobile?: boolean }).isMobile;
      const { ctx } = await ctxFor(br, { ...dev, ...(d.viewport ? { viewport: d.viewport } : {}) });
      const pg = await ctx.newPage(); const issues: string[] = [];
      try {
        for (const lang of ['en', 'de', 'da']) for (const p of ['/owner', `/owner/events?q=${tag}`, `/owner/events/${B.id}`, '/owner/log', '/owner/login?out=1']) {
          if (p.startsWith('/owner/login')) await ctx.clearCookies();
          await pg.goto(`${BASE}/${lang}${p}`); await pg.waitForLoadState('networkidle');
          issues.push(...(await pg.evaluate(AUDIT)).map((x) => `${lang}${p} ${x}`));
          if (p.startsWith('/owner/login')) { const j = jar(); const u = await mkUser(); await login(j, u); await ctx.addCookies([{ name: 'ga_owner', value: j.cookies.get('ga_owner')!, url: BASE }]); }
        }
        const w = (d.viewport ?? (dev as { viewport?: { width: number } }).viewport)?.width ?? 1280;
        if (w < 600) {
          await pg.goto(`${BASE}/en/owner/events?q=${tag}`);
          expect(await pg.locator('#o-events thead').evaluate((e) => getComputedStyle(e).position === 'absolute' || getComputedStyle(e).display === 'none' || e.getBoundingClientRect().height < 2)).toBe(true);
        }
      } finally { await ctx.close(); if (br !== b) await br.close(); }
      expect(issues).toEqual([]);
    }, 180_000);
  }
});
