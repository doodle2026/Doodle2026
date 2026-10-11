/** "Send til e-mails" (confirmation page, phase 1): API additions + minimal UI. Mail runs in log mode – nothing is sent. */
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

describe('API', () => {
  test('one recipient per call → results[] status; quota in GET; duplicates rejected; admin token required', async () => {
    const p = await poll(); const a = `a-${uniq()}@example.com`;
    expect((await call(`/api/events/${p.id}/invitations`, { method: 'POST', json: { recipients: [a] } })).status).toBe(401);
    const g0 = await call(`/api/events/${p.id}/invitations`, { token: p.token });
    expect(g0.body.quota).toMatchObject({ poll_remaining: 200 }); expect(g0.body.quota.day_remaining).toBeGreaterThan(0); expect(g0.body.quota.hour_remaining).toBeGreaterThan(0);
    const r = await send(p, { recipients: [`  ${a.toUpperCase()} `], locale: 'en' });
    expect(r.status).toBe(201);
    expect(r.body.results).toEqual([{ email: a, status: 'sent' }]);
    expect(r.body.quota.poll_remaining).toBe(199);
    expect(r.text).not.toContain(p.token);
    const row = await prisma.invitation.findFirstOrThrow({ where: { email: a, event: { slug: p.id } } });
    expect(row.locale).toBe('en'); // creator's language
    const again = await send(p, { recipients: [a] });
    expect(again.status).toBe(400); expect(again.body.code).toBe('no_new_recipients');
  });

  test('suppressed address → status unsub (never mailed); retry only for failed', async () => {
    const p = await poll(); const s = `s-${uniq()}@example.com`, f = `f-${uniq()}@example.com`;
    await prisma.emailSuppression.create({ data: { emailHash: emailHash(s), scope: 'all' } });
    const r = await send(p, { recipients: [s] });
    expect(r.status).toBe(201); expect(r.body.results).toEqual([{ email: s, status: 'unsub' }]); expect(r.body.sent).toBe(0);
    await send(p, { recipients: [f] });
    expect((await call(`/api/events/${p.id}/invitations/retry`, { method: 'POST', token: p.token, json: { email: f } })).body.code).toBe('not_failed');
    await prisma.invitation.updateMany({ where: { email: f, event: { slug: p.id } }, data: { delivery: 'failed' } });
    const rt = await call(`/api/events/${p.id}/invitations/retry`, { method: 'POST', token: p.token, json: { email: f } });
    expect(rt.status).toBe(200); expect(rt.body.sent).toBe(1);
    expect((await prisma.invitation.findFirstOrThrow({ where: { email: f, event: { slug: p.id } } })).delivery).toBe('sent');
    expect((await prisma.event.findUniqueOrThrow({ where: { slug: p.id } })).inviteTracking).toBe(false); // retry doesn't switch tracking on
    expect((await call(`/api/events/${p.id}/invitations/retry`, { method: 'POST', token: p.token, json: { email: s } })).status).toBe(409);
  });
});

describe.skipIf(!existsSync(CHROME))('UI (headless)', () => {
  let browser: Browser;
  beforeAll(async () => { const { chromium } = await import('playwright-core'); browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] }); });
  afterAll(async () => { await browser?.close(); });

  test('confirmation page: box under the admin link; Enter sends one line → Sendt ✓; invalid / duplicate blocked; survives reload in the tab; not for visitors', async () => {
    const p = await poll();
    const pg = await browser.newPage();
    await pg.goto(`${BASE}/da`);
    await pg.evaluate(([id, tok]) => sessionStorage.setItem(`mt-admin-${id}`, `/p/${id}/admin#${tok}`), [p.id, p.token]);
    await pg.goto(`${BASE}/da/p/${p.id}?created=1`);
    await pg.waitForSelector('#send-mails #sm-rows input');
    expect(await pg.locator('#sm-rows li').count()).toBe(5);
    // order: admin link box comes first
    expect(await pg.evaluate(() => !!(document.querySelector('#adminurl')!.compareDocumentPosition(document.querySelector('#send-mails')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    const inputs = pg.locator('#sm-rows input');
    await inputs.nth(0).fill('ikke-en-mail'); await inputs.nth(0).blur();
    await pg.waitForSelector('text=Ugyldig e-mailadresse');
    expect(await pg.locator('#sm-rows button').first().isDisabled()).toBe(true);
    const a = `ui-${uniq()}@example.com`;
    await inputs.nth(0).fill(a); await inputs.nth(0).press('Enter');
    await pg.waitForSelector(`#sm-sent li:has(input[value="${a}"])`);
    expect(await pg.textContent('#sm-sent')).toContain('Sendt ✓');
    await pg.locator('#sm-rows input').nth(0).fill(a.toUpperCase()); await pg.locator('#sm-rows input').nth(0).blur();
    await pg.waitForSelector('#sm-rows >> text=Allerede inviteret');
    await pg.click('#sm-more'); expect(await pg.locator('#sm-rows li').count()).toBe(9);
    await pg.reload(); await pg.waitForSelector(`#sm-sent li:has(input[value="${a}"])`);
    const v = await browser.newPage(); await v.goto(`${BASE}/da/p/${p.id}`); await v.waitForLoadState('networkidle');
    expect(await v.locator('#send-mails').count()).toBe(0);
    await v.close(); await pg.close();
  });
});
