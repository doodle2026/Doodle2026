/** "Send til e-mails" (confirmation page, phase 2 – "Indsæt mange", §46.7). Mail runs in log mode – nothing is sent. */
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
const ip = () => `10.51.${(Math.random() * 255) | 0}.${(Math.random() * 250 + 1) | 0}`;
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


test('splitBulk: semicolon, comma, newline, Outlook "Name <x>"', async () => {
  const { splitBulk } = await import('../src/components/SendToEmails');
  expect(splitBulk('a@x.dk; b@x.dk,c@x.dk\n"Dina D" <d@x.dk>; Eva <e@x.dk>')).toEqual(['a@x.dk', 'b@x.dk', 'c@x.dk', 'd@x.dk', 'e@x.dk']);
});

test('API: many recipients in ONE call → per-address results incl. neutral blocked; retry {emails[]} in one call', async () => {
  const p = await poll(); const s = `s-${uniq()}@example.com`, a = `a-${uniq()}@example.com`, b = `b-${uniq()}@example.com`;
  await prisma.emailSuppression.create({ data: { emailHash: emailHash(s), scope: 'all' } });
  const r = await send(p, { recipients: [a, s, b] });
  expect(r.status).toBe(201);
  expect(r.body.results).toEqual(expect.arrayContaining([{ email: a, status: 'sent' }, { email: s, status: 'blocked' }, { email: b, status: 'sent' }]));
  expect(r.body.remaining.poll).toBe(198);
  expect((await call(`/api/events/${p.id}/invitations/check`, { method: 'POST', token: p.token, json: { recipients: a } })).status).toBe(404); // no pre-check endpoint
});

const HAS = existsSync(CHROME);
describe.skipIf(!HAS)('UI (headless)', () => {
  let browser: Browser;
  beforeAll(async () => { const { chromium } = await import('playwright-core'); browser = await chromium.launch({ executablePath: CHROME }); });
  afterAll(async () => { await browser?.close(); });

  test('Indsæt mange: paste → overview (valid/invalid/dup/already), remove, Send til N (one call) → per-address status, blocked neutral, mode remembered, switch back removes duplicates with message', async () => {
    const p = await poll(); const pre = `pre-${uniq()}@example.com`, s = `s-${uniq()}@example.com`;
    await send(p, { recipients: [pre] });
    await prisma.emailSuppression.create({ data: { emailHash: emailHash(s), scope: 'all' } });
    const pg = await browser.newPage();
    await pg.goto(`${BASE}/da`);
    await pg.evaluate(([id, tok]) => { sessionStorage.setItem(`mt-admin-${id}`, `/p/${id}/admin#${tok}`); localStorage.removeItem('ga-se-mode'); }, [p.id, p.token]);
    await pg.goto(`${BASE}/da/p/${p.id}?created=1`);
    await pg.waitForSelector('#se-rows input');
    const a = `a-${uniq()}@example.com`;
    await pg.waitForSelector('#se-rows li[data-status="earlier"]'); await pg.locator('#se-rows li[data-status="idle"] input').first().fill(a);
    await pg.click('[data-mode="bulk"]');
    expect(await pg.evaluate(() => localStorage.getItem('ga-se-mode'))).toBe('bulk');
    await pg.waitForSelector('#se-bulk');
    await pg.fill('#se-bulk', `Bo B <b-x@example.com>; ikke-mail, ${a}\n${pre}; ${s};`);
    await pg.waitForSelector('#se-blist li[data-kind="invalid"]');
    const sum = await pg.textContent('#se-bulk-sum');
    expect(sum).toContain('3 gyldige'); expect(sum).toContain('1 ugyldig'); expect(sum).toContain('1 dublet'); expect(sum).toContain('1 allerede inviteret');
    expect(await pg.textContent('#se-bsend')).toBe('Send til 3');
    await pg.click('#se-bclean');
    await pg.waitForFunction(() => document.querySelectorAll('#se-blist li:not([data-kind="sent"])').length === 3); // + the earlier sent address as a green chip (§46.7)
    let posts = 0; pg.on('request', (r) => { if (r.method() === 'POST' && /\/invitations$/.test(r.url())) posts++; });
    await pg.click('#se-bsend');
    await pg.waitForSelector('#se-blist li[data-kind="blocked"]');
    expect(posts).toBe(1);
    expect(await pg.locator('#se-blist li[data-kind="sent"]').count()).toBe(3); // earlier + 2 new
    const txt = (await pg.textContent('#se-blist'))! + (await pg.textContent('#se-bulk-sum'));
    expect(txt).toContain('kan ikke sendes'); expect(txt).not.toMatch(/afmeld|frabedt/i);
    // back to lines: duplicates removed with a message
    await pg.fill('#se-bulk', 'x1@example.com; x1@example.com;');
    await pg.waitForFunction(() => document.querySelectorAll('#se-blist li[data-kind="dup"]').length === 1);
    await pg.click('[data-mode="rows"]');
    await pg.waitForSelector('#se-notice:not([hidden])');
    expect(await pg.textContent('#se-notice')).toBe('1 dublet fjernet');
    const vals = await pg.locator('#se-rows input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(vals.filter((v) => v === 'x1@example.com')).toHaveLength(1);
    await pg.close();
  });

  test('Indsæt mange: >50 and quota checked before sending (button disabled with message)', async () => {
    const p = await poll();
    const pg = await browser.newPage();
    await pg.goto(`${BASE}/da`);
    await pg.evaluate(([id, tok]) => { sessionStorage.setItem(`mt-admin-${id}`, `/p/${id}/admin#${tok}`); localStorage.setItem('ga-se-mode', 'bulk'); }, [p.id, p.token]);
    await pg.goto(`${BASE}/da/p/${p.id}?created=1`);
    await pg.waitForSelector('#se-bulk:visible');
    await pg.fill('#se-bulk', Array.from({ length: 62 }, (_, i) => `g${i}-${uniq()}@example.com`).join('; ') + ';');
    await pg.waitForSelector('#se-bulk-err >> text=Højst 50 ad gangen – fjern 12.');
    expect(await pg.isDisabled('#se-bsend')).toBe(true);
    await pg.close();
  });
});
