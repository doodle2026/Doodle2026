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

  test('opted-out address → neutral "blocked", not stored, same status code + shape as a normal send; retry only for failed', async () => {
    const p = await poll(); const s = `s-${uniq()}@example.com`, f = `f-${uniq()}@example.com`;
    await prisma.emailSuppression.create({ data: { emailHash: emailHash(s), scope: 'all' } });
    const t0 = Date.now(); const r = await send(p, { recipients: [s] }); const dt = Date.now() - t0;
    expect(r.status).toBe(201); expect(r.body.results).toEqual([{ email: s, status: 'blocked' }]);
    expect(dt).toBeGreaterThanOrEqual(390); // minimum response time – rejected isn't faster than a send
    expect(r.text).not.toMatch(/unsub|suppress|afmeld|frabedt/i);
    expect(await prisma.invitation.count({ where: { email: s, event: { slug: p.id } } })).toBe(0);
    const ok = await send(p, { recipients: [f] });
    expect(Object.keys(ok.body).sort()).toEqual(Object.keys(r.body).sort());
    expect((await call(`/api/events/${p.id}/invitations/retry`, { method: 'POST', token: p.token, json: { email: f } })).body.code).toBe('not_failed');
    await prisma.invitation.updateMany({ where: { email: f, event: { slug: p.id } }, data: { delivery: 'failed' } });
    const rt = await call(`/api/events/${p.id}/invitations/retry`, { method: 'POST', token: p.token, json: { email: f } });
    expect(rt.status).toBe(200); expect(rt.body.sent).toBe(1); expect(rt.body.quota).toBeTruthy();
    expect((await prisma.invitation.findFirstOrThrow({ where: { email: f, event: { slug: p.id } } })).delivery).toBe('sent');
    await prisma.invitation.updateMany({ where: { email: f, event: { slug: p.id } }, data: { delivery: 'failed' } });
    const many = await call(`/api/events/${p.id}/invitations/retry`, { method: 'POST', token: p.token, json: { emails: [f, `nope-${uniq()}@example.com`] } });
    expect(many.status).toBe(200); expect(many.body.results).toEqual([{ email: f, status: 'sent' }, expect.objectContaining({ status: 'failed' })]); expect(many.body.remaining).toBeTruthy();
    // already sent → reported as not_failed, not re-sent
    const again = await call(`/api/events/${p.id}/invitations/retry`, { method: 'POST', token: p.token, json: { emails: [f] } });
    expect(again.body.results).toEqual([{ email: f, status: 'not_failed' }]);
  });

  test('admin API never exposes unsub/bounced (neutral blocked); §46.8 remaining + invitations shape', async () => {
    const p = await poll(); const a = `a-${uniq()}@example.com`, b = `b-${uniq()}@example.com`;
    await send(p, { recipients: [a] }); await send(p, { recipients: [b] });
    await prisma.invitation.updateMany({ where: { email: a, event: { slug: p.id } }, data: { delivery: 'unsub' } });
    await prisma.invitation.updateMany({ where: { email: b, event: { slug: p.id } }, data: { delivery: 'bounced' } });
    const g = await call(`/api/events/${p.id}/invitations`, { token: p.token });
    expect(g.body.invitees.map((i: { delivery: string }) => i.delivery)).toEqual(['blocked', 'blocked']);
    expect(g.body.remaining).toMatchObject({ poll: 198 }); expect(g.body.remaining.hour).toBeGreaterThan(0); expect(g.body.remaining.day).toBeGreaterThan(0);
    expect(g.text).not.toMatch(/unsub/);
  });

  test('box follows the poll tracking setting (personal link when tracking is on)', async () => {
    const p = await poll(); const a = `t-${uniq()}@example.com`;
    await prisma.event.update({ where: { slug: p.id }, data: { inviteTracking: true } });
    await send(p, { recipients: [a] });
    expect((await prisma.invitation.findFirstOrThrow({ where: { email: a, event: { slug: p.id } } })).inviteGen).toBe(1);
  });
});

describe.skipIf(!existsSync(CHROME))('UI (headless)', () => {
  let browser: Browser;
  beforeAll(async () => { const { chromium } = await import('playwright-core'); browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] }); });
  afterAll(async () => { await browser?.close(); });

  test('confirmation page (§46): box inside the share panel under the admin link; Enter sends → Sendt ✓; invalid after blur; duplicate with line number; reload shows "Sendt tidligere"; not for visitors', async () => {
    const p = await poll();
    const pg = await browser.newPage();
    await pg.goto(`${BASE}/da`);
    await pg.evaluate(([id, tok]) => sessionStorage.setItem(`mt-admin-${id}`, `/p/${id}/admin#${tok}`), [p.id, p.token]);
    await pg.goto(`${BASE}/da/p/${p.id}?created=1`);
    await pg.waitForSelector('#se #se-rows input');
    expect(await pg.locator('#se-rows li').count()).toBe(5);
    expect(await pg.evaluate(() => !!(document.querySelector('#adminurl')!.compareDocumentPosition(document.querySelector('#se')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    expect(await pg.textContent('#se')).toContain('Vi sender aldrig dit admin-link.');
    const inp = (i: number) => pg.locator('#se-rows input').nth(i);
    await inp(0).fill('ikke-en-mail'); await inp(1).focus();
    await pg.waitForSelector('#se-rows >> text=Ugyldig e-mailadresse');
    const a = `ui-${uniq()}@Example.COM`;
    await inp(0).fill(a); await inp(1).fill(a.toLowerCase());
    await pg.waitForSelector('#se-rows >> text=Står allerede i linje 1.');
    await inp(0).press('Enter');
    await pg.waitForSelector('#se-rows li[data-status="sent"]');
    expect(await inp(0).inputValue()).toBe(a.replace('@Example.COM', '@example.com'));
    expect(await pg.evaluate(() => document.activeElement?.id)).toMatch(/^se-i/);
    await pg.waitForSelector('#se-rows >> text=Gensend fra admin.');
    await inp(2).fill('kladde@example.com'); await pg.click('#se-pm-toggle'); await pg.fill('#se-pmsg', 'Hej');
    await pg.click('#share-close'); await pg.waitForSelector('#share', { state: 'hidden' }); await pg.waitForSelector('#se-rows');
    expect(await pg.locator('#se-rows input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toContain('kladde@example.com');
    expect(await pg.inputValue('#se-pmsg')).toBe('Hej');
    await pg.click('#share-open'); await pg.waitForSelector('#share #se-rows');
    expect(await pg.inputValue('#se-pmsg')).toBe('Hej');
    const before = await pg.locator('#se-rows li').count(); await pg.click('#se-more'); expect(await pg.locator('#se-rows li').count()).toBe(before + 5);
    await prisma.invitation.updateMany({ where: { event: { slug: p.id } }, data: { delivery: 'bounced' } });
    await pg.reload(); await pg.waitForSelector('#se-rows >> text=Afvist – tjek adressen');
    await prisma.invitation.updateMany({ where: { event: { slug: p.id } }, data: { delivery: 'sent' } });
    await pg.reload(); await pg.waitForSelector('#se-rows li[data-status="earlier"]');
    expect(await pg.textContent('#se-rows')).toContain('Sendt tidligere');
    const v = await browser.newPage(); await v.goto(`${BASE}/da/p/${p.id}`); await v.waitForLoadState('networkidle');
    expect(await v.locator('#se').count()).toBe(0);
    await v.close(); await pg.close();
  });
});
