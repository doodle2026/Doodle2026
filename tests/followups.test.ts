/** Follow-ups to #15/#16: P1 deleted participant's edit link, P2 calendar hydration, E1 delivery after resubscribe, E2 masked address. */
import { describe, test, expect, inject, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import type { Browser } from 'playwright-core';
import { TEST_WEBHOOK_SECRET } from './global-setup';

const BASE = inject('baseUrl');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const Y = new Date().getUTCFullYear() + 1;
const ip = () => `10.31.${(Math.random() * 255) | 0}.${(Math.random() * 250 + 1) | 0}`;
const uniq = () => Math.random().toString(36).slice(2, 10);
const linkToken = (id: number) => createHmac('sha256', 'dev-only-email-link-secret-not-for-production').update(`moedetid-inv-link-v1:${id}`).digest('base64url');
async function call(path: string, init: RequestInit & { token?: string; json?: unknown } = {}) {
  const headers: Record<string, string> = { 'X-Forwarded-For': ip(), ...(init.headers as Record<string, string>) };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  const text = await r.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; } // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: r.status, body, text };
}
async function poll() {
  const r = await call('/api/events', { method: 'POST', json: { title: 'Opfølgning', options: [{ date: `${Y}-11-03` }] } });
  return { id: r.body.id as string, token: r.body.admin_token as string, o: r.body.time_options[0].id as number };
}
async function deletedVoter() {
  const p = await poll();
  const v = await call(`/api/events/${p.id}/votes`, { method: 'POST', json: { name: 'Slettet', votes: [{ option_id: p.o, value: 'yes' }] } });
  expect((await call(`/api/events/${p.id}/participants/${v.body.participant_id}`, { method: 'DELETE', token: p.token })).status).toBe(200);
  return { p, edit: v.body.edit_token as string };
}

describe('P1 deleted participant', () => {
  test('edit link → 410 participant_deleted (GET + PUT); unknown token stays 403; tombstone cascades with the poll', async () => {
    const { p, edit } = await deletedVoter();
    const g = await call(`/api/events/${p.id}/votes/me`, { token: edit });
    expect(g.status).toBe(410); expect(g.body.code).toBe('participant_deleted');
    expect((await call(`/api/events/${p.id}/votes/me`, { method: 'PUT', token: edit, json: { name: 'X', votes: [{ option_id: p.o, value: 'no' }] } })).status).toBe(410);
    expect((await call(`/api/events/${p.id}/votes/me`, { token: 'Z'.repeat(43) })).status).toBe(403);
    const other = await poll(); // token of poll A is not "deleted" on poll B
    expect((await call(`/api/events/${other.id}/votes/me`, { token: edit })).status).toBe(403);
    expect((await call(`/api/events/${p.id}`, { method: 'DELETE', token: p.token })).status).toBe(200);
    expect(await prisma.deletedParticipant.count({ where: { event: { slug: p.id } } })).toBe(0);
  });
});

describe('E1/E2 unsubscribe', () => {
  test('delivered → unsubscribe → resubscribe restores delivered; webhooks while unsubscribed are kept; address masked', async () => {
    const p = await poll(); const a = `anna-${uniq()}@example.com`;
    expect((await call(`/api/events/${p.id}/invitations`, { method: 'POST', token: p.token, json: { recipients: a } })).status).toBe(201);
    const row = () => prisma.invitation.findFirstOrThrow({ where: { email: a, event: { slug: p.id } } });
    const id = (await row()).providerId!;
    const hook = (type: string) => {
      const body = JSON.stringify({ type, data: { email_id: id } }), ts = Math.floor(Date.now() / 1000), sid = `msg_${uniq()}`;
      const sig = createHmac('sha256', Buffer.from(TEST_WEBHOOK_SECRET.slice(6), 'base64')).update(`${sid}.${ts}.${body}`).digest('base64');
      return call('/api/webhooks/resend', { method: 'POST', headers: { 'svix-id': sid, 'svix-timestamp': String(ts), 'svix-signature': `v1,${sig}`, 'Content-Type': 'application/json' }, body });
    };
    const t = linkToken((await row()).id);
    const info = await call(`/api/u/p/${t}`);
    expect(info.body.email).toBe('a•••@example.com'); expect(info.text).not.toContain(a);
    // sent → unsub → (delivered arrives while unsubscribed) → resubscribe → delivered
    await call(`/api/u/p/${t}`, { method: 'POST', json: { action: 'unsubscribe' } });
    expect((await row()).delivery).toBe('unsub');
    await hook('email.delivered');
    expect((await row()).delivery).toBe('unsub');
    const re = await call(`/api/u/p/${t}`, { method: 'POST', json: { action: 'resubscribe' } });
    expect(re.body.email).toBe('a•••@example.com');
    expect((await row()).delivery).toBe('delivered');
    // delivered → unsub (all) → resubscribe → delivered, idempotent double unsubscribe
    await call(`/api/u/all/${t}`, { method: 'POST', json: { action: 'unsubscribe' } });
    await call(`/api/u/p/${t}`, { method: 'POST', json: { action: 'unsubscribe' } });
    await call(`/api/u/p/${t}`, { method: 'POST', json: { action: 'resubscribe' } });
    expect((await row()).delivery).toBe('unsub'); // still globally unsubscribed
    await call(`/api/u/all/${t}`, { method: 'POST', json: { action: 'resubscribe' } });
    expect((await row()).delivery).toBe('delivered');
  });
});

describe('P3', () => {
  test('no Doodle mention in public/app.css', () => {
    expect(readFileSync('public/app.css', 'utf8')).not.toMatch(/doodle/i);
  });
});

describe.skipIf(!existsSync(CHROME))('headless: P1 notice, P2 no hydration mismatch', () => {
  let browser: Browser;
  beforeAll(async () => { const { chromium } = await import('playwright-core'); browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] }); });
  afterAll(async () => { await browser?.close(); });

  test('P1: deleted participant opening their edit link sees "Dit svar er slettet"', async () => {
    const { p, edit } = await deletedVoter();
    const pg = await browser.newPage();
    await pg.goto(`${BASE}/p/${p.id}#edit=${edit}`);
    await pg.waitForSelector('#deleted-mine');
    expect(await pg.textContent('#deleted-mine')).toContain('Dit svar er slettet');
    expect(await pg.locator('text=Redigeringslinket er ugyldigt').count()).toBe(0);
    await pg.close();
  });

  test('P2: create page calendar renders without hydration errors (far-off TZ)', async () => {
    const ctx = await browser.newContext({ timezoneId: 'Pacific/Kiritimati' });
    const pg = await ctx.newPage(); const errs: string[] = [];
    pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    pg.on('pageerror', (e) => errs.push(e.message));
    await pg.goto(`${BASE}/`);
    await pg.waitForSelector('.dp table');
    await pg.waitForTimeout(300);
    expect(errs.filter((e) => /hydrat|did not match/i.test(e))).toEqual([]);
    await ctx.close();
  });
});
