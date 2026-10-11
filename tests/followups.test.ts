/** "Send til e-mails" (confirmation page, follow-ups L1–L8 + tester hooks. Mail runs in log mode – nothing is sent. */
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


test('L1: stricter address validation', async () => {
  const { validEmail } = await import('../src/lib/recipients');
  for (const ok of ['a@x.dk', 'a.b@x.dk', `${'a'.repeat(64)}@x.dk`]) expect(validEmail(ok)).toBe(true);
  for (const bad of ['.a@x.dk', 'a.@x.dk', 'a..b@x.dk', `${'a'.repeat(65)}@x.dk`, 'a@x..dk']) expect(validEmail(bad)).toBe(false);
});

test('L4/H3: splitBulkNamed keeps display names; server stores the name', async () => {
  const { splitBulkNamed } = await import('../src/components/SendToEmails');
  expect(splitBulkNamed('x@a.dk; "Lund, Jan" <jan@a.dk>, Eva <eva@a.dk>')).toEqual([
    { raw: 'x@a.dk', email: 'x@a.dk' }, { raw: '"Lund, Jan" <jan@a.dk>', email: 'jan@a.dk', name: 'Lund, Jan' }, { raw: 'Eva <eva@a.dk>', email: 'eva@a.dk', name: 'Eva' }]);
  const p = await poll(); const e = `n-${uniq()}@example.com`;
  await send(p, { recipients: [`"Lund, Jan" <${e}>`] });
  expect((await prisma.invitation.findFirstOrThrow({ where: { email: e, event: { slug: p.id } } })).name).toBe('Lund, Jan');
});

test('L2: overlapping concurrent sends → per-address already_invited, the rest sent', async () => {
  const p = await poll(); const s = `shared-${uniq()}@example.com`, a = `a-${uniq()}@example.com`, b = `b-${uniq()}@example.com`;
  const [r1, r2] = await Promise.all([send(p, { recipients: [s, a] }), send(p, { recipients: [s, b] })]);
  expect([r1.status, r2.status]).toEqual([201, 201]);
  const all = [...r1.body.results, ...r2.body.results];
  expect(all.filter((x: { email: string; status: string }) => x.email === s).map((x: { status: string }) => x.status).sort()).toEqual(['already_invited', 'sent']);
  expect(all.find((x: { email: string }) => x.email === a).status).toBe('sent');
  expect(all.find((x: { email: string }) => x.email === b).status).toBe('sent');
  expect(await prisma.invitation.count({ where: { event: { slug: p.id } } })).toBe(3);
});

test('L3: mail endpoints are not limited by the general 20-writes IP limit', async () => {
  const p = await poll();
  FIXED_IP = `10.77.${(Math.random() * 255) | 0}.9`;
  try {
    for (let i = 0; i < 25; i++) expect((await send(p, { recipients: [`l3-${i}-${uniq()}@example.com`] })).status).toBe(201);
    // other admin writes still have the general limit
    let last = 0; for (let i = 0; i < 25; i++) last = (await call(`/api/events/${p.id}`, { method: 'PATCH', token: p.token, json: { title: `t${i}` } })).status;
    expect(last).toBe(429);
  } finally { FIXED_IP = ''; }
}, 60_000);

test('tester hooks are inert outside capture mode', async () => {
  const { captureShouldFail } = await import('../src/lib/email/capture');
  const capEnv = { NODE_ENV: 'test', EMAIL_MODE: 'capture', EMAIL_CAPTURE_FAIL: '^fail-' } as unknown as NodeJS.ProcessEnv;
  expect(captureShouldFail(['fail-x@a.dk'], capEnv)).toBe(true);
  expect(captureShouldFail(['ok@a.dk'], capEnv)).toBe(false);
  expect(captureShouldFail(['fail-x@a.dk'], { ...capEnv, EMAIL_MODE: 'log' })).toBe(false);
  expect(captureShouldFail(['fail-x@a.dk'], { ...capEnv, NODE_ENV: 'production' })).toBe(false);
  expect(captureShouldFail(['fail-x@a.dk'], { ...capEnv, VERCEL: '1' })).toBe(false);
  const once = { ...capEnv, EMAIL_CAPTURE_FAIL_ONCE: '1' } as NodeJS.ProcessEnv;
  const e = `fail-${uniq()}@a.dk`;
  expect(captureShouldFail([e], once)).toBe(true); expect(captureShouldFail([e], once)).toBe(false);
  expect((await call('/api/test/delivery', { method: 'POST', json: { email: 'x@a.dk', event: 'bounced' } })).status).toBe(404);
});

const HAS = existsSync(CHROME);
describe.skipIf(!HAS)('UI (headless)', () => {
  let browser: Browser;
  beforeAll(async () => { const { chromium } = await import('playwright-core'); browser = await chromium.launch({ executablePath: CHROME }); });
  afterAll(async () => { await browser?.close(); });

  test('L6 hint shows <…> literally decoded; L4 names on chips; L5 Backspace removes last chip; L8 focus stays in list; L7 hour message', async () => {
    const p = await poll();
    const pg = await browser.newPage();
    await pg.goto(`${BASE}/da`);
    await pg.evaluate(([id, tok]) => { sessionStorage.setItem(`mt-admin-${id}`, `/p/${id}/admin#${tok}`); localStorage.setItem('ga-se-mode', 'bulk'); }, [p.id, p.token]);
    await pg.goto(`${BASE}/da/p/${p.id}?created=1`);
    await pg.waitForSelector('#se-bulk:visible');
    const hint = await pg.textContent('#se-bulk-hint');
    expect(hint).toContain('"Navn <mail@x.dk>"'); expect(hint).not.toContain('&lt;');
    await pg.fill('#se-bulk', '"Lund, Jan" <jan@example.com>; b@example.com; c@example.com;');
    await pg.waitForFunction(() => document.querySelectorAll('#se-blist li').length === 3);
    expect(await pg.textContent('#se-blist li:first-child')).toContain('Lund, Jan');
    await pg.focus('#se-bulk'); await pg.keyboard.press('Backspace');
    await pg.waitForFunction(() => document.querySelectorAll('#se-blist li').length === 2);
    await pg.focus('#se-blist li:first-child .se-x'); await pg.keyboard.press('Enter');
    await pg.waitForFunction(() => document.querySelectorAll('#se-blist li').length === 1);
    await pg.waitForFunction(() => document.activeElement?.classList.contains('se-x'));
    // L7: hour limit → its own message
    await pg.route('**/invitations', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const r = await route.fetch(); const j = await r.json(); j.remaining = { poll: 190, hour: 1, day: 90 };
      await route.fulfill({ response: r, json: j });
    });
    await pg.reload(); await pg.waitForSelector('#se-bulk:visible');
    await pg.fill('#se-bulk', 'h1@example.com; h2@example.com;');
    await pg.waitForSelector('#se-bulk-err >> text=Kun 1 invitationer tilbage i denne time – fjern 1.');
    await pg.close();
  });
});
