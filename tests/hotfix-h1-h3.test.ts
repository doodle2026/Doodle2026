/** "Send til e-mails" (confirmation page, hotfix H1–H3. Mail runs in log mode – nothing is sent. */
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


test('H3: quoted Outlook names with commas – server and client', async () => {
  const { parseRecipients } = await import('../src/lib/recipients');
  const { splitBulk } = await import('../src/components/SendToEmails');
  const txt = '"Lund, Jan" <jan@x.dk>; "Hansen; Bo" <bo@x.dk>, Eva <eva@x.dk>, plain@x.dk';
  expect(parseRecipients(txt).valid).toEqual([{ email: 'jan@x.dk', name: 'Lund, Jan' }, { email: 'bo@x.dk', name: 'Hansen; Bo' }, { email: 'eva@x.dk', name: 'Eva' }, { email: 'plain@x.dk' }]);
  expect(parseRecipients(txt).invalid).toEqual([]);
  expect(splitBulk(txt)).toEqual(['jan@x.dk', 'bo@x.dk', 'eva@x.dk', 'plain@x.dk']);
});

test('H2: old link formats → token in #fragment, no-store, before the locale redirect', async () => {
  const p = await poll();
  const go = (u: string) => fetch(BASE + u, { redirect: 'manual', headers: { 'Accept-Language': 'da' } });
  let r = await go(`/p/${p.id}/admin/${p.token}`);
  expect(r.status).toBe(302); expect(new URL(r.headers.get('location')!, BASE).pathname + new URL(r.headers.get('location')!, BASE).hash).toBe(`/da/p/${p.id}/admin#${p.token}`);
  expect(r.headers.get('cache-control')).toContain('no-store'); expect(r.headers.get('referrer-policy')).toBe('no-referrer');
  r = await go(`/en/p/${p.id}/admin/${p.token}`); expect(r.headers.get('location')).toContain(`/en/p/${p.id}/admin#${p.token}`);
  r = await go(`/p/${p.id}?edit=abc123&x=1`);
  const l = new URL(r.headers.get('location')!, BASE);
  expect(l.pathname).toBe(`/da/p/${p.id}`); expect(l.search).toBe('?x=1'); expect(l.hash).toBe('#edit=abc123');
  expect(r.headers.get('cache-control')).toContain('no-store');
  r = await go(`/e/${p.id}`); expect(new URL(r.headers.get('location')!, BASE).pathname).toBe(`/da/p/${p.id}`);
  const { readFileSync } = await import('node:fs');
  expect(readFileSync('src/middleware.ts', 'utf8') + readFileSync('src/lib/legacy-links.ts', 'utf8')).not.toMatch(/console\./);
});

const HAS = existsSync(CHROME);
describe.skipIf(!HAS)('H1 polling (headless, fake clock)', () => {
  let browser: Browser;
  beforeAll(async () => { const { chromium } = await import('playwright-core'); browser = await chromium.launch({ executablePath: CHROME }); });
  afterAll(async () => { await browser?.close(); });
  async function open(p: { id: string; token: string }) {
    const pg = await browser.newPage();
    let n = 0; pg.on('request', (r) => { if (r.method() === 'GET' && /\/invitations$/.test(r.url())) n++; });
    await pg.clock.install();
    await pg.goto(`${BASE}/da`);
    await pg.evaluate(([id, tok]) => sessionStorage.setItem(`mt-admin-${id}`, `/p/${id}/admin#${tok}`), [p.id, p.token]);
    await pg.goto(`${BASE}/da/p/${p.id}?created=1`);
    await pg.waitForSelector('#se-rows');
    return { pg, count: () => n };
  }
  test('0 invitations: exactly one initial GET, none over 2 minutes', async () => {
    const p = await poll(); const { pg, count } = await open(p);
    await pg.waitForTimeout(1500); expect(count()).toBe(1);
    await pg.clock.runFor(120_000); await pg.waitForTimeout(500);
    expect(count()).toBe(1);
    await pg.close();
  });
  test('with invitations: one GET per 20 s; reload shows earlier invites (Sendt tidligere / Afvist / Prøv igen)', async () => {
    const p = await poll(); const a = `a-${uniq()}@example.com`, b = `b-${uniq()}@example.com`, c = `c-${uniq()}@example.com`;
    await send(p, { recipients: [a] }); await send(p, { recipients: [b] }); await send(p, { recipients: [c] });
    await prisma.invitation.updateMany({ where: { email: b, event: { slug: p.id } }, data: { delivery: 'bounced' } });
    await prisma.invitation.updateMany({ where: { email: c, event: { slug: p.id } }, data: { delivery: 'failed' } });
    const { pg, count } = await open(p);
    await pg.waitForSelector('#se-rows li[data-status="earlier"]');
    const txt = await pg.textContent('#se-rows');
    expect(txt).toContain('Sendt tidligere'); expect(txt).toContain('Kan ikke sendes til denne adresse'); expect(txt).not.toMatch(/afvist/i);
    expect(await pg.locator(`#se-rows li:has(input[value="${c}"])`).locator('button', { hasText: 'Prøv igen' }).count()).toBe(1);
    await pg.waitForTimeout(1500); const base = count(); expect(base).toBe(1);
    await pg.clock.runFor(61_000); await pg.waitForTimeout(800);
    expect(count() - base).toBe(3);
    await pg.close();
  });
});
