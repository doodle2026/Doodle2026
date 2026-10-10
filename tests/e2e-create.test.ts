/** Headless Chrome: create page with the month calendar (design §0.3). */
import { describe, test, expect, inject, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import type { Browser, Page } from 'playwright-core';

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const BASE = inject('baseUrl');
let browser: Browser;
const focused = (p: Page) => p.evaluate(() => document.activeElement?.getAttribute('data-d') ?? document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.id);
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe.skipIf(!existsSync(CHROME))('create with calendar (headless Chrome)', () => {
  beforeAll(async () => { const { chromium } = await import('playwright-core'); browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] }); });
  afterAll(async () => { await browser?.close(); });

  test('ARIA grid + keyboard, past disabled, chips with focus rules, counter, submit → date poll', async () => {
    const p = await browser.newPage({ viewport: { width: 1200, height: 1000 }, timezoneId: 'Europe/Copenhagen' });
    await p.goto(`${BASE}/`);
    await p.waitForSelector('#dp table[role="grid"][aria-multiselectable="true"]');
    const today = await p.evaluate(() => new Intl.DateTimeFormat('en-CA').format(new Date()));
    const yesterday = iso(new Date(Date.parse(`${today}T00:00:00Z`) - 86400_000));
    if (await p.$(`#dp td[data-d="${yesterday}"]`)) expect(await p.getAttribute(`#dp td[data-d="${yesterday}"]`, 'aria-disabled')).toBe('true');
    expect(await p.getAttribute(`#dp td[data-d="${today}"]`, 'class')).toContain('is-today');
    expect(await p.getAttribute(`#dp td[data-d="${today}"]`, 'aria-label')).toContain('i dag');
    // empty submit → error
    await p.fill('#title', 'Kalender');
    await p.click('#submit');
    expect(await p.textContent('#prop-err')).toBe('Vælg mindst én dato i kalenderen.');
    // keyboard: go to next month, select 3 days
    await p.focus(`#dp td[tabindex="0"]`);
    await p.keyboard.press('PageDown');
    const start = (await focused(p))!;
    await p.keyboard.press('Space');
    await p.keyboard.press('ArrowRight'); await p.keyboard.press('Enter');
    await p.keyboard.press('ArrowDown'); await p.keyboard.press('Shift+Enter'); // range up to +8 days
    const picked = await p.$$eval('#date-chips [data-chip]', (els) => els.map((e) => e.getAttribute('data-chip')));
    expect(picked.length).toBe(9);
    expect(picked[0]).toBe(start);
    expect(await p.textContent('#date-count')).toBe('9/100 datoer');
    expect(await p.getAttribute(`#dp td[data-d="${start}"]`, 'aria-selected')).toBe('true');
    // remove 2nd chip → focus moves to the next chip
    await p.click(`[data-chip="${picked[1]}"] button`);
    await expect.poll(() => p.evaluate(() => document.activeElement?.closest('[data-chip]')?.getAttribute('data-chip'))).toBe(picked[2]);
    // remove last chip → focus to previous
    await p.click(`[data-chip="${picked[8]}"] button`);
    await expect.poll(() => p.evaluate(() => document.activeElement?.closest('[data-chip]')?.getAttribute('data-chip'))).toBe(picked[7]);
    expect(await p.textContent('#date-count')).toBe('7/100 datoer');
    await p.click('#submit');
    await p.waitForURL(/\/p\/[A-Za-z0-9_-]{22}\?created=1/);
    const id = new URL(p.url()).pathname.split('/')[2];
    const ev = await (await fetch(`${BASE}/api/events/${id}`)).json();
    expect(ev).not.toHaveProperty('mode');
    expect(ev.time_options.map((o: { date: string }) => o.date)).toEqual(picked.filter((_, i) => i !== 1 && i !== 8));
    expect(await p.textContent('#grid-h')).toBe('Hvilke datoer passer dig?');
    await p.close();
  }, 45_000);

  test('Ryd alle; Shift+click range; max 100 enforced with message', async () => {
    const p = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await p.goto(`${BASE}/`);
    await p.waitForSelector('#dp td[tabindex="0"]');
    await p.click('#dp [aria-label="Næste måned"]');
    const days = await p.$$eval('#dp td:not(.dp__day--out):not([aria-disabled])', (els) => els.map((e) => e.getAttribute('data-d')!));
    await p.click(`#dp td[data-d="${days[0]}"]`);
    await p.click(`#dp td[data-d="${days[4]}"]`, { modifiers: ['Shift'] });
    expect(await p.$$eval('#date-chips li', (l) => l.length)).toBe(5);
    await p.click('#clear-dates');
    expect(await p.$$eval('#date-chips li', (l) => l.length)).toBe(0);
    // 100 via repeated month ranges, then one more → error
    let n = 0;
    for (let m = 0; m < 5 && n < 100; m++) {
      const ds = await p.$$eval('#dp td:not(.dp__day--out):not([aria-disabled])', (els) => els.map((e) => e.getAttribute('data-d')!));
      const take = ds.slice(0, Math.min(ds.length, 100 - n));
      await p.click(`#dp td[data-d="${take[0]}"]`);
      if (take.length > 1) await p.click(`#dp td[data-d="${take[take.length - 1]}"]`, { modifiers: ['Shift'] });
      n += take.length;
      await p.click('#dp [aria-label="Næste måned"]');
    }
    expect(await p.textContent('#date-count')).toBe('100/100 datoer');
    expect(await p.getAttribute('#date-count', 'class')).toContain('counter--over');
    await p.click('#dp td:not(.dp__day--out):not(.is-sel):not([aria-disabled]) >> nth=0');
    expect(await p.textContent('#prop-err')).toBe('Du kan højst vælge 100 datoer.');
    await p.close();
  }, 45_000);
});
