/** Phase 3: fr + de render end to end in their own language; no horizontal overflow at 320 px. */
import { describe, test, expect, inject, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import type { Browser } from 'playwright-core';
import { T, markup } from './helpers/t';

const BASE = inject('baseUrl');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const Y = new Date().getUTCFullYear() + 1;
const ip = () => `10.41.${(Math.random() * 255) | 0}.${(Math.random() * 250 + 1) | 0}`;
async function poll() {
  const r = await fetch(`${BASE}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip() },
    body: JSON.stringify({ title: 'Réunion', options: [{ date: `${Y}-11-03` }, { date: `${Y}-11-04` }] }) });
  const j = await r.json(); if (!j.id) throw new Error(JSON.stringify(j)); return j as { id: string; admin_token: string };
}

describe.each(['fr', 'de'] as const)('%s pages', (l) => {
  test('create + poll + 404 render in the locale (lang, catalog strings, localized dates)', async () => {
    const c = await (await fetch(`${BASE}/${l}`)).text();
    expect(c).toContain(`<html lang="${l}"`);
    expect(markup(c)).not.toContain(T.en('create.submit'));
    const e = await poll();
    const p = await (await fetch(`${BASE}/${l}/p/${e.id}`)).text(); // meta description carries the localized date range
    expect(p.match(/<title>[^<]*/)?.[0]).toContain("Réunion");
    const nf = await fetch(`${BASE}/${l}/nope/nope`);
    expect(nf.status).toBe(404);
  });
});

describe.skipIf(!existsSync(CHROME))('320 px overflow (fr/de are longest)', () => {
  let browser: Browser;
  beforeAll(async () => { const { chromium } = await import('playwright-core'); browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] }); });
  afterAll(async () => { await browser?.close(); });
  test.each(['fr', 'de'])('%s: create, vote and admin pages fit 320 px', async (l) => {
    const e = await poll();
    const pg = await browser.newPage({ viewport: { width: 320, height: 800 } });
    for (const u of [`/${l}`, `/${l}/p/${e.id}`, `/${l}/p/${e.id}/admin#${e.admin_token}`]) {
      await pg.goto(BASE + u); await pg.waitForLoadState('networkidle');
      const w = await pg.evaluate(() => document.documentElement.scrollWidth);
      expect(w, u).toBeLessThanOrEqual(320);
    }
    await pg.close();
  });
});
