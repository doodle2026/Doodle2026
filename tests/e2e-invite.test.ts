/** Headless Chrome: invite form, status list, reminder dialog, unsubscribe/abuse landing pages (design §36-40). */
import { describe, test, expect, inject, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Browser } from 'playwright-core';

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const BASE = inject('baseUrl');
const Y = new Date().getUTCFullYear() + 1;
const prisma = new PrismaClient();
let browser: Browser;
const ip = () => `10.30.${(Math.random() * 255) | 0}.${(Math.random() * 250 + 1) | 0}`;
const u = () => Math.random().toString(36).slice(2, 9);
const linkToken = (id: number) => createHmac('sha256', 'dev-only-email-link-secret-not-for-production').update(`moedetid-inv-link-v1:${id}`).digest('base64url');

async function poll() {
  const r = await fetch(`${BASE}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip() },
    body: JSON.stringify({ title: 'Invitér E2E', options: [{ date: `${Y}-11-03` }] }) });
  return r.json() as Promise<{ id: string; admin_token: string }>;
}

describe.skipIf(!existsSync(CHROME))('invitations UI (headless Chrome)', () => {
  beforeAll(async () => { const { chromium } = await import('playwright-core'); browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] }); });
  afterAll(async () => { await browser?.close(); await prisma.$disconnect(); });

  test('invite form: groups, counter, send → status list; reminder dialog → 1 af 3 brugt + countdown', async () => {
    const e = await poll(); const k = u();
    const p = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
    await p.goto(`${BASE}/p/${e.id}/admin#${e.admin_token}`);
    await p.waitForSelector('#inv-form');
    await p.fill('#addr', `a-${k}@firma.dk, Bo Hansen <bo-${k}@firma.dk>; pia@firma a-${k}@firma.dk`);
    expect(await p.textContent('#groups')).toContain('Ugyldige – rettes eller fjernes (1)');
    expect(await p.textContent('#groups')).toContain('Dubletter – fjernet automatisk (1)');
    expect(await p.isDisabled('#inv-send')).toBe(true);
    await p.fill('#addr', `a-${k}@firma.dk, Bo Hansen <bo-${k}@firma.dk>`);
    await p.fill('#pmsg', 'x'.repeat(1005));
    expect(await p.textContent('#pmsg-err')).toBe('Beskeden er 5 tegn for lang.');
    await p.fill('#pmsg', 'Hej alle');
    await p.fill('#orgname', 'Mette');
    expect(await p.textContent('#mailprev')).toContain('Mette via GrabAday');
    expect(await p.textContent('#inv-send')).toBe('Send 2 invitationer');
    await p.click('#inv-send');
    await p.waitForSelector('#rtable tbody tr:nth-child(2)');
    expect(await p.textContent('#rtable')).toContain(`bo-${k}@firma.dk`);
    expect(await p.textContent('#filters')).toContain('Alle2');
    await p.click('#rem-btn');
    await p.waitForSelector('dialog[open]');
    expect(await p.evaluate(() => document.activeElement?.id)).toBe('rem-cancel');
    await p.click('#rem-ok');
    await p.waitForFunction(() => document.querySelector('#reminder')?.textContent?.includes('1 af 3 brugt'));
    expect(await p.isDisabled('#rem-btn')).toBe(true);
    expect(await p.textContent('#rem-wait')).toMatch(/Næste påmindelse kan sendes om \d+ t \d+ min/);
    await p.close();
  }, 40_000);

  test('landing pages: GET alone does not unsubscribe (scanner-safe); JS page does; undo; all needs a click; abuse form', async () => {
    const e = await poll(); const a = `l-${u()}@firma.dk`;
    await fetch(`${BASE}/api/events/${e.id}/invitations`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${e.admin_token}`, 'X-Forwarded-For': ip() }, body: JSON.stringify({ recipients: a }) });
    const inv = await prisma.invitation.findFirstOrThrow({ where: { email: a } });
    const t = linkToken(inv.id);
    await fetch(`${BASE}/u/p/${t}`); // a link scanner
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })).delivery).not.toBe('unsub');
    const p = await browser.newPage();
    await p.goto(`${BASE}/u/p/${t}`);
    await p.waitForSelector('#undo');
    expect(await p.textContent('h1')).toBe('Du er afmeldt');
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })).delivery).toBe('unsub');
    await p.click('#undo'); await p.waitForSelector('#re');
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })).delivery).toBe('sent');
    await p.goto(`${BASE}/u/all/${t}`); await p.waitForSelector('#go');
    expect(await prisma.emailSuppression.count({ where: { scope: 'all', createdAt: { gt: new Date(Date.now() - 60_000) } } })).toBeGreaterThanOrEqual(0);
    await p.click('#go'); await p.waitForFunction(() => document.querySelector('h1')?.textContent === 'Du er afmeldt alle mails');
    await p.goto(`${BASE}/abuse/${t}`); await p.waitForSelector('#f');
    await p.check('input[value="phishing"]'); await p.click('#f button');
    await p.waitForFunction(() => document.querySelector('h1')?.textContent?.startsWith('Tak'));
    expect(await prisma.abuseReport.count({ where: { eventId: inv.eventId, reason: 'phishing' } })).toBe(1);
    await p.goto(`${BASE}/u/p/${'Z'.repeat(43)}`); await p.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('ugyldigt'));
    await p.close();
  }, 40_000);
});
