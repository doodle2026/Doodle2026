/**
 * Headless browser regression tests for the voting UI (Chrome via playwright-core).
 * Skipped when no Chrome is available (set CHROME_PATH to override the default location).
 */
import { describe, test, expect, inject, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import type { Browser } from 'playwright-core';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const BASE = inject('baseUrl');
const Y = new Date().getUTCFullYear() + 1;
let browser: Browser;

async function poll(dates = [`${Y}-11-03`, `${Y}-11-04`]) {
  const r = await fetch(`${BASE}/api/events`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.6.${(Math.random() * 255) | 0}.1` },
    body: JSON.stringify({ title: 'E2E', options: dates.map((date) => ({ date })) }),
  });
  return r.json() as Promise<{ id: string; admin_token: string }>;
}

describe.skipIf(!existsSync(CHROME))('voting UI (headless Chrome)', () => {
  beforeAll(async () => {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  });
  afterAll(async () => { await browser?.close(); await prisma.$disconnect(); });

  test('V2: "Måske" chosen after a dropped first save is saved as Måske, not the earlier "Nej"', async () => {
    const { id } = await poll();
    const p = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    let first = true;
    await p.route('**/api/events/*/votes*', async (r) => {
      // First POST reaches the server and is committed, but the response is lost (flaky network).
      if (first && r.request().method() === 'POST') { first = false; await r.fetch(); return r.abort('connectionreset'); }
      return r.continue();
    });
    await p.goto(`${BASE}/da/p/${id}`);
    await p.fill('#name', 'Mette');
    for (let k = 0; k < 3; k++) await p.click('.tri[data-i="0"]'); // → Nej
    await p.click('#save');
    await p.waitForSelector('#summary li');
    for (let k = 0; k < 3; k++) await p.click('.tri[data-i="0"]'); // Nej → none → Ja → Måske
    expect(await p.textContent('.tri[data-i="0"]')).toContain('Måske');
    await p.click('#save');
    await p.waitForSelector('#summary li, #saved-msg');
    const api = await (await fetch(`${BASE}/api/events/${id}`)).json();
    // Never silently "Nej": either Måske was saved, or the user is told the save didn't go through.
    const mette = api.participants.find((x: { name: string }) => x.name === 'Mette');
    if (await p.$('#saved-msg')) expect(mette.votes[0]).toBe('maybe');
    else expect(await p.textContent('#summary')).toMatch(/ikke gemt|allerede brugt|svaret/);
    await p.close();
  }, 30_000);

  test('V2: rapid clicks cycle from the current value (none → Ja → Måske), saved as maybe', async () => {
    const { id } = await poll();
    const p = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await p.goto(`${BASE}/da/p/${id}`);
    await p.fill('#name', 'Hurtig');
    await p.dblclick('.tri[data-i="0"]');
    expect(await p.textContent('.tri[data-i="0"]')).toContain('Måske');
    await p.click('#save');
    await p.waitForSelector('#saved-msg');
    const api = await (await fetch(`${BASE}/api/events/${id}`)).json();
    expect(api.participants[0].votes).toEqual(['maybe', null]);
    await p.close();
  }, 30_000);

  test('V3 mobile hint, V4 name error clears on change, V6 totals only saved, date column heads', async () => {
    const { id } = await poll();
    const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await m.goto(`${BASE}/da/p/${id}`);
    await m.waitForFunction(() => document.querySelector('#hint')?.textContent?.includes('Ja, Måske eller Nej'));
    expect(await m.textContent('#hint')).not.toMatch(/celle|←/);
    await m.click('#save'); // empty name → error
    expect(await m.textContent('#name-err')).toMatch(/Skriv dit navn/);
    await m.type('#name', 'A');
    expect(await m.textContent('#name-err')).toBe('');
    await m.close();

    const d = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await d.goto(`${BASE}/da/p/${id}`);
    expect(await d.textContent('#hint')).toMatch(/celle/);
    await d.click('.tri[data-i="0"]'); // unsaved Ja
    expect(await d.textContent('tfoot')).toContain('0 ja');
    expect(await d.$('thead th.is-best')).toBeNull();
    expect(await d.textContent('thead')).toMatch(/(Man|Tir|Ons|Tor|Fre|Lør|Søn)\.\s*3\. nov\./);
    expect(await d.textContent('#grid-h')).toBe('Hvilke datoer passer dig?');
    await d.close();
  }, 30_000);

  test('date columns render identically in browser time zones UTC+14 and UTC−10 (no shift)', async () => {
    const { id } = await poll([`${Y}-03-29`, `${Y}-11-01`]);
    const heads: string[] = [];
    for (const timezoneId of ['Pacific/Kiritimati', 'America/Adak', 'UTC']) {
      const ctx = await browser.newContext({ timezoneId, viewport: { width: 1100, height: 900 } });
      const pg = await ctx.newPage();
      await pg.goto(`${BASE}/da/p/${id}`);
      await pg.waitForSelector('#grid thead');
      expect(await pg.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(timezoneId);
      heads.push((await pg.textContent('#grid thead'))!);
      await ctx.close();
    }
    expect(new Set(heads).size).toBe(1);
    expect(heads[0]).toContain('29. mar.');
    expect(heads[0]).toContain('1. nov.');
    expect(heads[0]).not.toMatch(/\d\d[:.]\d\d/);
  }, 30_000);

  test('V5: returning voter sees a different message once the poll is closed', async () => {
    const { id, admin_token } = await poll();
    const p = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await p.goto(`${BASE}/da/p/${id}`);
    await p.fill('#name', 'Sofie');
    await p.click('.tri[data-i="0"]');
    await p.click('#save');
    await p.waitForSelector('#saved-msg');
    expect(await p.textContent('#saved-msg')).toContain('Tak, Sofie');
    await fetch(`${BASE}/api/events/${id}/close`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin_token}`, 'X-Forwarded-For': '10.6.9.9' }, body: '{}' });
    await p.reload();
    await p.waitForSelector('#saved-msg');
    expect(await p.textContent('#saved-msg')).toBe('Du har svaret som Sofie. Afstemningen er lukket, så svarene kan ikke længere ændres.');
    expect(await p.$('.vgrid__edit')).toBeNull();
    await p.close();
  }, 30_000);
});
