/** "Send til e-mails" (confirmation page, follow-up: test delivery events, one Send nyt link per row. Mail runs in log mode – nothing is sent. */
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


import { vi } from 'vitest';
vi.mock('@/lib/email/capture', async (orig) => ({ ...(await orig<object>()), captureActive: () => true }));

test('/api/test/delivery (capture only): delivered and unsubscribed', async () => {
  const { POST } = await import('../src/app/api/test/delivery/route');
  const p = await poll(); const a = `d-${uniq()}@example.com`, u = `u-${uniq()}@example.com`;
  await send(p, { recipients: [a] }); await send(p, { recipients: [u] });
  const post = (json: unknown) => POST(new Request('http://x/api/test/delivery', { method: 'POST', body: JSON.stringify(json) }));
  expect((await (await post({ email: a, event: 'delivered', poll: p.id })).json())).toEqual({ updated: 1 });
  const before = (await prisma.invitation.findFirst({ where: { email: u } }))!.delivery;
  expect((await (await post({ email: u, event: 'unsubscribed', poll: p.id })).json())).toEqual({ updated: 1 });
  expect(await prisma.invitation.findFirst({ where: { email: a }, select: { delivery: true } })).toEqual({ delivery: 'delivered' });
  expect(await prisma.invitation.findFirst({ where: { email: u }, select: { delivery: true, deliveryBeforeUnsub: true } })).toEqual({ delivery: 'unsub', deliveryBeforeUnsub: before });
  expect((await post({ email: a, event: 'opened' })).status).toBe(400);
  // the box: delivered is final; unsubscribed is neutral blocked
  const g = await call(`/api/events/${p.id}/invitations`, { token: p.token });
  expect(g.body.invitations).toEqual(expect.arrayContaining([{ email: a, status: 'delivered' }, { email: u, status: 'blocked' }]));
  // PM: bounced is neutral in the box as well – never 'bounced'
  await post({ email: a, event: 'bounced', poll: p.id });
  const g2 = await call(`/api/events/${p.id}/invitations`, { token: p.token });
  expect(g2.body.invitations).toEqual(expect.arrayContaining([{ email: a, status: 'blocked' }]));
  expect(JSON.stringify(g2.body.invitations)).not.toContain('bounced');
});

describe.skipIf(!existsSync(CHROME))('admin list', () => {
  test('exactly one "Send nyt link" per row in the DOM at desktop and mobile widths', async () => {
    const { chromium } = await import('playwright-core');
    const b = await chromium.launch({ executablePath: CHROME });
    const p = await poll(); const a = `r-${uniq()}@example.com`;
    await prisma.event.update({ where: { slug: p.id }, data: { inviteTracking: true } });
    await send(p, { recipients: [a] });
    for (const width of [1280, 390, 320]) {
      const pg = await b.newPage({ viewport: { width, height: 800 } });
      await pg.goto(`${BASE}/da/p/${p.id}/admin#${p.token}`);
      await pg.locator(`[data-resend="${a}"]`).first().waitFor();
      expect(await pg.locator(`[data-resend="${a}"]`).count()).toBe(1);
      expect(await pg.locator(`[data-resend="${a}"]`).isVisible()).toBe(true);
      expect(await pg.locator('#rtable').count()).toBe(1); // one markup at all widths (CSS restyles it) → no flash
      expect(await pg.locator('#rlist').count()).toBe(0);
      await pg.close();
    }
    await b.close();
  });
});
