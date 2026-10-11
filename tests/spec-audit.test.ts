/** "Send til e-mails" (confirmation page, spec audit §38/§44.8/§46.2/§46.7/§46.9. Mail runs in log mode – nothing is sent. */
import { describe, test, expect, inject, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import type { Browser } from 'playwright-core';
import { emailHash } from '../src/lib/invitations';

const BASE = inject('baseUrl');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const Y = new Date().getUTCFullYear() + 1;
let FIXED_IP = '';
const ip = () => FIXED_IP || `10.51.${(Math.random() * 255) | 0}.${(Math.random() * 250 + 1) | 0}`;
const uniq = () => Math.random().toString(36).slice(2, 10);
async function call(path: string, init: RequestInit & { token?: string; json?: unknown } = {}) {
  const headers: Record<string, string> = { 'X-Forwarded-For': ip() };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined });
  const text = await r.text(); let body: any; try { body = JSON.parse(text); } catch { body = text; } // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: r.status, body, text };
}
async function poll(locale = 'da') {
  const r = await call('/api/events', { method: 'POST', json: { locale, title: 'Send til e-mails', options: [{ date: `${Y}-11-03` }] } });
  return { id: r.body.id as string, token: r.body.admin_token as string };
}
const send = (p: { id: string; token: string }, json: unknown) => call(`/api/events/${p.id}/invitations`, { method: 'POST', token: p.token, json });


import * as pwc from 'playwright-core';

test('§46.9 helpers: Retry-After seconds/HTTP date, minutes rounded up, < 60 s → 0', async () => {
  const { parseRetryAfter, waitMinutes } = await import('../src/components/SendToEmails');
  const now = Date.parse('2026-10-11T12:00:00Z');
  expect(parseRetryAfter('90', now)).toBe(90);
  expect(parseRetryAfter('Sun, 11 Oct 2026 12:24:00 GMT', now)).toBe(1440);
  expect(parseRetryAfter(null, now)).toBeNull(); expect(parseRetryAfter('soon', now)).toBeNull();
  expect(waitMinutes(59)).toBe(0); expect(waitMinutes(60)).toBe(1); expect(waitMinutes(61)).toBe(2); expect(waitMinutes(1440)).toBe(24);
});

test('§38 (audit 2): failed keeps its explanation; bounced and unsubscribed are neutral blocked without reason', async () => {
  const p = await poll(); const [f, b, u] = ['f', 'b', 'u'].map((k) => `${k}-${uniq()}@example.com`);
  for (const e of [f, b, u]) await send(p, { recipients: [e] });
  await prisma.invitation.updateMany({ where: { email: f }, data: { delivery: 'failed', reason: 'Midlertidig fejl hos modtagerens server – prøver igen' } });
  await prisma.invitation.updateMany({ where: { email: b }, data: { delivery: 'bounced', reason: 'Adressen findes ikke (hard bounce)' } });
  await prisma.invitation.updateMany({ where: { email: u }, data: { delivery: 'unsub' } });
  const g = await call(`/api/events/${p.id}/invitations`, { token: p.token });
  const by = Object.fromEntries(g.body.invitees.map((i: { email: string }) => [i.email, i]));
  expect(by[f]).toMatchObject({ delivery: 'failed', reason: 'Midlertidig fejl hos modtagerens server – prøver igen' });
  expect(by[b]).toMatchObject({ delivery: 'blocked', reason: null });
  expect(by[u]).toMatchObject({ delivery: 'blocked', reason: null });
  expect(JSON.stringify(g.body.invitees)).not.toMatch(/bounce|unsub|afmeld/i);
});

test('§46.2 (audit 3): invitations[] exposes delivered (final) – admin unaffected', async () => {
  const p = await poll(); const a = `d-${uniq()}@example.com`;
  await send(p, { recipients: [a] });
  await prisma.invitation.updateMany({ where: { email: a }, data: { delivery: 'delivered' } });
  const g = await call(`/api/events/${p.id}/invitations`, { token: p.token });
  expect(g.body.invitations).toEqual([{ email: a, status: 'delivered' }]);
});

test('§46.9 (audit 4): per-IP 429 → error rate_ip (+ legacy code), Retry-After, remaining', async () => {
  const p = await poll();
  FIXED_IP = `10.66.${(Math.random() * 255) | 0}.7`;
  try {
    // test server: RATE_LIMIT_MAIL_PER_HOUR=1000 → exhaust it with cheap invalid bodies (the limiter runs before validation)
    const hit = () => fetch(BASE + `/api/events/${p.id}/invitations`, { method: 'POST', headers: { 'X-Forwarded-For': FIXED_IP, Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json' }, body: '{"recipients":[]}' });
    let r = { status: 0, body: {} as Record<string, unknown> }; let hdr: string | null = null;
    for (let i = 0; i < 25 && r.status !== 429; i++) {
      const rs = await Promise.all(Array.from({ length: 50 }, hit));
      const lim = rs.find((x) => x.status === 429);
      if (lim) { r = { status: 429, body: await lim.json() }; hdr = lim.headers.get('retry-after'); }
    }
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ error: 'rate_ip', code: 'ip_limit' });
    expect(Number(hdr)).toBeGreaterThan(0);
    expect(r.body.remaining).toMatchObject({ poll: 200 });
  } finally { FIXED_IP = ''; }
}, 120_000);

const HAS = existsSync(CHROME);
const MATRIX: { id: string; browser: 'chromium' | 'firefox' | 'webkit'; device?: string; viewport?: { width: number; height: number } }[] = [
  { id: 'iphone-14', browser: 'webkit', device: 'iPhone 14' }, { id: 'pixel-7', browser: 'chromium', device: 'Pixel 7' },
  { id: 'ipad-gen7', browser: 'webkit', device: 'iPad (gen 7)' }, { id: 'desktop-chromium', browser: 'chromium', viewport: { width: 1280, height: 900 } },
  { id: 'desktop-firefox', browser: 'firefox', viewport: { width: 1280, height: 900 } }, { id: 'desktop-webkit', browser: 'webkit', viewport: { width: 1280, height: 900 } },
];
const avail = (b: string) => { try { return existsSync((pwc as unknown as Record<string, { executablePath(): string }>)[b].executablePath()); } catch { return false; } };
async function ctxFor(d: typeof MATRIX[number]) {
  const b = await pwc[d.browser].launch(d.browser === 'chromium' ? { executablePath: CHROME } : {});
  const dev = d.device ? { ...pwc.devices[d.device] } : {}; if (d.browser === 'firefox') delete (dev as { isMobile?: boolean }).isMobile;
  const ctx = await b.newContext({ ...dev, ...(d.viewport ? { viewport: d.viewport } : {}), locale: 'da-DK' });
  return { b, ctx };
}
const overflow = () => { const r: string[] = []; document.querySelectorAll('button,.btn,.se-bitem').forEach((e) => { const el = e as HTMLElement; if (el.offsetParent && el.scrollWidth > el.clientWidth + 1) r.push(el.textContent!.trim().slice(0, 24)); }); if (document.documentElement.scrollWidth > innerWidth + 1) r.push('page-hscroll'); return r; };

describe.skipIf(!HAS)('UI across the device matrix (§0.1)', () => {
  for (const d of MATRIX) {
    test.skipIf(!avail(d.browser))(`${d.id}: §44.8 Send nyt link dialog; §46.7 Ctrl+Enter sends + sent shown in both views; §46.9 IP message`, async () => {
      const { b, ctx } = await ctxFor(d);
      try {
        // §44.8
        const p = await poll(); const a = `t-${uniq()}@example.com`;
        await prisma.event.update({ where: { slug: p.id }, data: { inviteTracking: true } });
        await send(p, { recipients: [a] });
        const ad = await ctx.newPage();
        await ad.goto(`${BASE}/da/p/${p.id}/admin#${p.token}`);
        const btn = ad.locator(`[data-resend="${a}"]:visible`).first();
        await btn.waitFor();
        expect((await btn.textContent())!.trim()).toBe('Send nyt link');
        await btn.click();
        await ad.waitForSelector('dialog[open] #c-h');
        expect(await ad.textContent('dialog[open] #c-h')).toBe(`Send et nyt link til ${a}?`);
        expect(await ad.textContent('dialog[open]')).toContain('Det gamle link holder op med at virke');
        expect(await ad.evaluate(() => document.activeElement?.id)).toBe('c-cancel');
        expect(await ad.evaluate(overflow)).toEqual([]);
        await ad.click('#c-ok');
        await ad.waitForSelector('#inv-toast >> text=Det gamle virker ikke længere');
        await ad.close();
        // §46.7 + §46.9 on the confirmation page
        const q = await poll(); const pre = `pre-${uniq()}@example.com`; await send(q, { recipients: [pre] });
        const pg = await ctx.newPage();
        await pg.goto(`${BASE}/da`);
        await pg.evaluate(([id, tok]) => { sessionStorage.setItem(`mt-admin-${id}`, `/p/${id}/admin#${tok}`); localStorage.setItem('ga-se-mode', 'bulk'); }, [q.id, q.token]);
        await pg.goto(`${BASE}/da/p/${q.id}?created=1`);
        await pg.waitForSelector('#se-bulk:visible');
        await pg.click('[data-mode="rows"]'); await pg.click('[data-mode="bulk"]'); // earlier sent row → green chip as well
        await pg.waitForSelector(`#se-blist li[data-kind="sent"]`);
        const n1 = `c1-${uniq()}@example.com`;
        await pg.fill('#se-bulk', `${n1}; ikke-en-mail`);
        let posts = 0; pg.on('request', (r) => { if (r.method() === 'POST' && /\/invitations$/.test(r.url())) posts++; });
        await pg.press('#se-bulk', process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
        await pg.waitForFunction(() => document.querySelectorAll('#se-blist li[data-kind="sent"]').length === 2);
        expect(posts).toBe(1);
        expect(await pg.evaluate(overflow)).toEqual([]);
        await pg.click('[data-mode="rows"]');
        const rows = await pg.locator('#se-rows input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
        expect(rows).toContain(pre); expect(rows).toContain(n1); expect(rows).toContain('ikke-en-mail');
        await pg.click('[data-mode="bulk"]');
        expect(await pg.locator('#se-blist li[data-kind="sent"]').count()).toBe(2); // still visible in bulk too
        // §46.9: 429 with HTTP-date Retry-After → "ca. N min" (rounded up); without header → hour message
        let mode: 'date' | 'none' = 'date';
        await pg.route('**/invitations', async (route) => {
          if (route.request().method() !== 'POST') return route.continue();
          const headers: Record<string, string> = { 'content-type': 'application/json' };
          if (mode === 'date') headers['retry-after'] = new Date(Date.now() + 23 * 60_000 + 10_000).toUTCString();
          await route.fulfill({ status: 429, headers, body: JSON.stringify({ error: 'rate_ip', remaining: { poll: 190, hour: 50, day: 90 } }) });
        });
        await pg.fill('#se-bulk', `x-${uniq()}@example.com;`);
        await pg.click('#se-bsend');
        await pg.waitForSelector('#se-limit >> text=Prøv igen om ca. 24 min');
        mode = 'none';
        await pg.reload(); await pg.waitForSelector('#se-bulk:visible');
        await pg.fill('#se-bulk', `y-${uniq()}@example.com;`);
        await pg.click('#se-bsend');
        await pg.waitForSelector('#se-limit >> text=For mange invitationer på kort tid – prøv igen om en time.');
        await pg.close();
      } finally { await ctx.close(); await b.close(); }
    }, 120_000);
  }

  test('§46.2 (audit 3): polling stops when all invitations are delivered/final', async () => {
    const p = await poll(); const a = `d-${uniq()}@example.com`; await send(p, { recipients: [a] });
    await prisma.invitation.updateMany({ where: { email: a }, data: { delivery: 'delivered' } });
    const b = await pwc.chromium.launch({ executablePath: CHROME }); const pg = await b.newPage();
    let n = 0; pg.on('request', (r) => { if (r.method() === 'GET' && /\/invitations$/.test(r.url())) n++; });
    await pg.clock.install();
    await pg.goto(`${BASE}/da`); await pg.evaluate(([id, tok]) => sessionStorage.setItem(`mt-admin-${id}`, `/p/${id}/admin#${tok}`), [p.id, p.token]);
    await pg.goto(`${BASE}/da/p/${p.id}?created=1`); await pg.waitForSelector('#se-rows li[data-status="earlier"]');
    await pg.waitForTimeout(1000); const base = n;
    await pg.clock.runFor(120_000); await pg.waitForTimeout(500);
    expect(n).toBe(base);
    await b.close();
  });
});
